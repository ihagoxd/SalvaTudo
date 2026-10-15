'use strict';

/**
 * Testes das partes puras: argumentos do yt-dlp, organização das pastas,
 * leitura do progresso, tradução dos erros e o resumo da análise.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const os = require('os');

process.env.SALVATUDO_DADOS = path.join(os.tmpdir(), `salvatudo-unidade-${process.pid}`);

const modelos = require('../src/motores/modelos');
const analise = require('../src/motores/analise');
const tiktok = require('../src/motores/tiktok');
const { nomeSeguro, extrairLinks, escaparModelo } = require('../src/nucleo/util');

/** @returns {import('../src/motores/modelos').Pedido} */
const pedido = (extra = {}) => ({
  tipo: 'video', qualidade: 'max', formatoVideo: 'mp4', formatoAudio: 'original',
  pasta: 'C:\\Downloads\\SalvaTudo\\Vídeos', organizar: 'canal', legendas: false, capaQuadrada: true, ...extra,
});

/* ---------------- formato e qualidade ---------------- */

test('vídeo MP4: resolução primeiro, depois H.264 + AAC, sem reconverter', () => {
  const a = modelos.argsFormato(pedido({ qualidade: '1080' }));
  assert.deepEqual(a, ['-f', 'bv*+ba/b', '-S', 'res:1080,fps,hdr:SDR,vcodec:h264,acodec:aac', '--merge-output-format', 'mp4/mkv']);
  assert.ok(!a.includes('--recode-video'), 'nunca reconverte o vídeo');
});

test('vídeo MKV: a melhor qualidade de cada resolução', () => {
  assert.deepEqual(modelos.argsFormato(pedido({ formatoVideo: 'mkv' })), ['-f', 'bv*+ba/b', '-S', 'res', '--merge-output-format', 'mkv', '--remux-video', 'mkv']);
});

test('áudio: original sem conversão, M4A prefere o AAC do site, MP3 em 320k', () => {
  assert.deepEqual(modelos.argsFormato(pedido({ tipo: 'audio' })), ['-f', 'ba/b', '-x']);
  assert.deepEqual(modelos.argsFormato(pedido({ tipo: 'audio', formatoAudio: 'm4a' })), ['-f', 'ba[acodec^=mp4a]/ba/b', '-x', '--audio-format', 'm4a']);
  assert.ok(modelos.argsFormato(pedido({ tipo: 'audio', formatoAudio: 'mp3' })).join(' ').includes('--audio-quality 320K'));
});

/* ---------------- pastas ---------------- */

test('organização dos vídeos: por canal, site, mês ou tudo junto', () => {
  assert.equal(modelos.modeloSaida(pedido()), '%(channel,uploader,creator|Outros)s/%(title,id)s.%(ext)s');
  assert.equal(modelos.modeloSaida(pedido({ organizar: 'site' })), '%(extractor_key|Outros)s/%(channel,uploader,creator|Outros)s/%(title,id)s.%(ext)s');
  assert.equal(modelos.modeloSaida(pedido({ organizar: 'data' })), '%(epoch>%Y-%m)s/%(title,id)s.%(ext)s');
  assert.equal(modelos.modeloSaida(pedido({ organizar: 'nenhuma' })), '%(title,id)s.%(ext)s');
});

test('músicas: artista e álbum (a pasta do álbum some quando não há álbum)', () => {
  assert.equal(modelos.modeloSaida(pedido({ tipo: 'audio', organizar: 'artista-album' })),
    '%(artist,creator,uploader,channel|Desconhecido)s/%(album|)s/%(title,id)s.%(ext)s');
});

test('playlist: pasta própria e numeração com zeros pelo tamanho da lista', () => {
  assert.equal(modelos.modeloSaida(pedido({ subpasta: 'Minha 100% playlist', indice: 7, totalLista: 120 })),
    'Minha 100%% playlist/007 - %(title,id)s.%(ext)s');
  assert.equal(modelos.modeloSaida(pedido({ subpasta: 'Lista', indice: 3, totalLista: 9 })), 'Lista/03 - %(title,id)s.%(ext)s');
});

test('músicas de playlist ganham o número da faixa; vídeos ganham capítulos e legendas', () => {
  const a = modelos.argsExtras(pedido({ tipo: 'audio', subpasta: 'Álbum', indice: 4 }));
  assert.ok(a.join(' ').includes('--parse-metadata 4:%(track_number)s'));
  assert.ok(a.includes('--ppa'), 'capa quadrada');
  const v = modelos.argsExtras(pedido({ legendas: true }));
  assert.ok(v.includes('--embed-chapters') && v.includes('--embed-subs'));
});

test('a linha de comando termina com -- antes do link (link nunca vira opção)', () => {
  const a = modelos.argsDownload('https://exemplo.com/v', pedido(), { dirCache: 'c', motorJs: 'node.exe', limiteVelocidade: 3 });
  assert.deepEqual(a.slice(-2), ['--', 'https://exemplo.com/v']);
  assert.ok(a.join(' ').includes('--limit-rate 3M'));
  assert.ok(a.includes('--no-mtime') && a.includes('--ignore-config'));
  assert.equal(a[a.indexOf('-P') + 1], 'C:\\Downloads\\SalvaTudo\\Vídeos');
});

/* ---------------- progresso ---------------- */

test('lê as linhas de progresso do yt-dlp', () => {
  const p = modelos.lerLinha('MBP|downloading|1048576|4194304|NA|524288.5|6|137|"C:\\\\x\\\\Vídeo.f137.mp4"');
  assert.deepEqual(p, { tipo: 'progresso', status: 'downloading', baixado: 1048576, total: 4194304, velocidade: 524288.5, eta: 6, formato: '137', arquivo: 'C:\\x\\Vídeo.f137.mp4' });
  assert.deepEqual(modelos.lerLinha('MBPP|started|Merger'), { tipo: 'etapa', status: 'started', processador: 'Merger' });
  assert.deepEqual(modelos.lerLinha('MBFIM|"D:\\\\a\\\\b.mp4"'), { tipo: 'fim', arquivo: 'D:\\a\\b.mp4' });
  assert.equal(modelos.lerLinha('[download] qualquer coisa'), null);
  const f = modelos.lerLinha('MBFMT|[{"format_id": "137", "filesize": 100}, {"format_id": "140", "filesize_approx": 50}]|"137+140"|null');
  assert.deepEqual(f, { tipo: 'formatos', formatos: [{ id: '137', tamanho: 100 }, { id: '140', tamanho: 50 }] });
  const i = modelos.lerLinha('MBINFO|{"title": "A | B", "id": "x"}');
  assert.ok(i && i.tipo === 'info');
  assert.equal(i.info.title, 'A | B', 'título com barra não quebra a leitura');
});

test('vídeo e áudio separados viram um progresso só', () => {
  const a = new modelos.Andamento();
  a.definirFormatos([{ id: '137', tamanho: 900 }, { id: '140', tamanho: 100 }]);
  a.registrar({ status: 'downloading', baixado: 450, total: 900, velocidade: 100, eta: 4, formato: '137' });
  assert.equal(Math.round(a.resumo().pct), 45);
  a.registrar({ status: 'finished', baixado: 900, total: 900, velocidade: null, eta: null, formato: '137' });
  a.registrar({ status: 'downloading', baixado: 50, total: 100, velocidade: 50, eta: 1, formato: '140' });
  const r = a.resumo();
  assert.equal(Math.round(r.pct), 95);
  assert.deepEqual(r.parte, { atual: 2, de: 2 });
  a.registrar({ status: 'finished', baixado: 100, total: 100, velocidade: null, eta: null, formato: '140' });
  assert.equal(a.resumo().pct, 100);
});

test('etapas depois do download ganham nome em português', () => {
  assert.equal(modelos.nomeEtapa('Merger'), 'Juntando vídeo e áudio');
  assert.equal(modelos.nomeEtapa('ExtractAudio', pedido({ tipo: 'audio', formatoAudio: 'mp3' })), 'Convertendo para MP3');
  assert.equal(modelos.nomeEtapa('MetadataParser'), null);
});

/* ---------------- erros ---------------- */

test('erros do yt-dlp viram frases claras', () => {
  const t = (e) => modelos.traduzirErro(`WARNING: algo\nERROR: ${e}`).mensagem;
  assert.match(t('[youtube] abc: Private video. Sign in if you\'ve been granted access'), /privado/);
  assert.match(t('[generic] Unsupported URL: https://exemplo.com'), /não leva a um vídeo/);
  assert.match(t('[youtube] abc: Sign in to confirm your age'), /restrição de idade/);
  assert.match(t('[Instagram] x: Requested content is not available, rate-limit reached or login required. Use --cookies'), /logado/);
  assert.match(t('[Reddit] x: Account authentication is required. Use --cookies-from-browser'), /logado/);
  assert.match(t('HTTP Error 429: Too Many Requests'), /excesso de pedidos/);
  assert.match(t('unable to download video data: HTTP Error 403: Forbidden'), /403/);
  assert.match(t('[Errno 28] No space left on device'), /disco está cheio/);
  assert.match(t('[youtube] x: Video unavailable. This video has been removed by the uploader'), /não está mais disponível/);
  const d = modelos.traduzirErro('ERROR: coisa estranha');
  assert.equal(d.detalhe, 'coisa estranha');
});

/* ---------------- nomes e links ---------------- */

test('nomes de pasta que o Windows aceita', () => {
  assert.equal(nomeSeguro('AC/DC: Live? <2024> | "Show"'), 'AC DC Live 2024 Show');
  assert.equal(nomeSeguro('con'), '_con');
  assert.equal(nomeSeguro('Título com ponto final...'), 'Título com ponto final');
  assert.equal(nomeSeguro('x'.repeat(300)).length, 120);
  assert.equal(escaparModelo('100% bom'), '100%% bom');
});

test('acha os links num texto colado, sem repetir', () => {
  const t = 'olha https://youtu.be/abc, e https://www.tiktok.com/@a/video/1.\nhttps://youtu.be/abc de novo';
  assert.deepEqual(extrairLinks(t), ['https://youtu.be/abc', 'https://www.tiktok.com/@a/video/1']);
  assert.deepEqual(extrairLinks('nada aqui'), []);
});

/* ---------------- análise ---------------- */

function formato(id, extra) {
  return { format_id: id, protocol: 'https', ...extra };
}

test('resumo de um vídeo: qualidades com o tamanho do formato que o yt-dlp vai escolher', () => {
  const info = {
    id: 'abc', extractor_key: 'Youtube', title: 'Vídeo', channel: 'Canal', duration: 100, webpage_url: 'https://youtu.be/abc',
    formats: [
      formato('140', { vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, filesize: 1000 }),
      formato('251', { vcodec: 'none', acodec: 'opus', abr: 129, filesize: 1100 }),
      formato('299', { vcodec: 'avc1.64002A', acodec: 'none', width: 1920, height: 1080, fps: 60, filesize: 30000 }),
      formato('399', { vcodec: 'av01.0.09M.08', acodec: 'none', width: 1920, height: 1080, fps: 60, filesize: 15000 }),
      // versão HLS de transmissão: maior, mas não é a escolhida
      formato('617', { vcodec: 'vp09', acodec: 'none', width: 1920, height: 1080, fps: 60, tbr: 9000, protocol: 'm3u8_native' }),
      formato('136', { vcodec: 'avc1.4d401f', acodec: 'none', width: 1280, height: 720, fps: 30, filesize: 9000 }),
    ],
    subtitles: { 'pt-BR': [{}] },
  };
  const r = analise.resumir(info);
  assert.equal(r.tipo, 'midia');
  assert.equal(r.chave, 'youtube:abc');
  assert.deepEqual(r.qualidades.map((q) => q.rotulo), ['1080p', '720p']);
  assert.equal(r.qualidades[0].fps, 60);
  assert.equal(r.qualidades[0].tamanho.mp4, 30000 + 1000, 'MP4: H.264 + AAC');
  assert.equal(r.qualidades[0].tamanho.mkv, 15000 + 1100, 'MKV: AV1 + Opus, metade do tamanho');
  assert.equal(r.audio.codec, 'Opus', 'mesma taxa: o Opus é o original preferido');
  assert.equal(r.legendas, true);
  assert.equal(r.temVideo, true);
});

test('vídeo em pé (1080x1920) conta como 1080p', () => {
  const r = analise.resumir({ id: 'v', formats: [formato('a', { vcodec: 'h264', acodec: 'aac', width: 1080, height: 1920, filesize: 10 })] });
  assert.equal(r.qualidades[0].altura, 1080);
});

test('site só de áudio (SoundCloud) não oferece vídeo', () => {
  const r = analise.resumir({ id: 's', extractor_key: 'Soundcloud', formats: [formato('mp3', { vcodec: 'none', acodec: 'mp3', abr: 128 })] });
  assert.equal(r.temVideo, false);
});

test('playlist: itens com link, capa e marca de indisponível', () => {
  const r = analise.resumir({
    _type: 'playlist', id: 'PL1', title: 'Minha lista', extractor_key: 'YoutubeTab',
    entries: [
      { id: 'a', ie_key: 'Youtube', url: 'https://www.youtube.com/watch?v=a', title: 'Um', duration: 60, thumbnails: [{ url: 'p.jpg', width: 168 }, { url: 'g.jpg', width: 336 }] },
      { id: 'b', ie_key: 'Youtube', url: 'https://www.youtube.com/watch?v=b', title: '[Private video]' },
    ],
  });
  assert.equal(r.tipo, 'lista');
  assert.equal(r.quantidade, 2);
  assert.equal(r.itens[0].chave, 'youtube:a');
  assert.equal(r.itens[0].miniatura, 'g.jpg');
  assert.equal(r.itens[1].indisponivel, true);
});

/* ---------------- TikTok ---------------- */

test('resolve o desafio anti-robô do TikTok (SHA-256)', () => {
  const base = Buffer.from('semente-qualquer');
  const numero = 4242;
  const esperado = crypto.createHash('sha256').update(base).update(String(numero)).digest();
  const dados = { v: { a: base.toString('base64'), b: 1, c: esperado.toString('base64') }, s: 'x' };
  const html = `<p id="wci" class="_wafchallengeid"></p><p id="cs" class="${Buffer.from(JSON.stringify(dados)).toString('base64')}"></p>`;
  const biscoitos = { mapa: new Map() };
  assert.equal(tiktok.resolverDesafio(html, biscoitos), true);
  const resposta = JSON.parse(Buffer.from(biscoitos.mapa.get('_wafchallengeid'), 'base64').toString());
  assert.equal(Buffer.from(resposta.d, 'base64').toString(), String(numero));
});

test('acha o vídeo de uma Live Photo, mas não confunde com a própria foto', () => {
  const foto = {
    imageURL: { urlList: ['https://p16.tiktokcdn.com/obj/x~tplv-photomode-image.jpeg'] },
    livePhoto: { video: { playAddr: { urlList: ['https://v16.tiktokcdn.com/video/tos/abc/?mime_type=video_mp4'] } } },
  };
  assert.deepEqual(tiktok.videosDaFoto(foto), ['https://v16.tiktokcdn.com/video/tos/abc/?mime_type=video_mp4']);
  assert.deepEqual(tiktok.videosDaFoto({ imageURL: { urlList: ['https://x/y.jpeg'] } }), []);
});
