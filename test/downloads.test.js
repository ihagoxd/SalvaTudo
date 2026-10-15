'use strict';

/**
 * Downloads de verdade, de ponta a ponta, pela mesma API que a tela usa:
 * analisar, baixar vídeo e áudio, organizar em pastas, pausar, continuar,
 * cancelar, erros e a proteção contra outros sites.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const apoio = require('./apoio');

const opcoes = { skip: apoio.FALTA || false, timeout: 180000 };
const SAIDA = path.join(apoio.TEMP, 'saida');
const pasta = (...p) => path.join(SAIDA, ...p);

/** @type {Awaited<ReturnType<typeof apoio.subirApp>>} */
let app;
/** @type {{url: string, fechar: () => Promise<void>}} */
let site;

before(async () => {
  if (apoio.FALTA) return;
  const midia = path.join(apoio.TEMP, 'site');
  fs.mkdirSync(midia, { recursive: true });
  apoio.gerarVideo(path.join(midia, 'video.mp4'));
  apoio.gerarVideo(path.join(midia, 'video-grande.mp4'), { segundos: 12, largura: 1280, altura: 720, taxa: '5M' });
  site = await apoio.siteLocal(midia);
  app = await apoio.subirApp();
  await app.put('/config', { pastaVideos: pasta('Vídeos'), pastaMusicas: pasta('Músicas'), pastaFotos: pasta('Fotos') });
});

after(async () => {
  if (site) await site.fechar();
  if (app) app.servidor.close();
  apoio.limpar();
});

/** Manda baixar e espera terminar (concluído, erro ou cancelado). */
async function baixar(corpo) {
  const r = await app.post('/baixar', corpo);
  assert.equal(r.ok, true, r.erro);
  const antes = new Set();
  return apoio.esperar(async () => {
    const f = await app.get('/fila');
    const item = f.itens.find((i) => i.url === corpo.itens[0].url && i.pedido.tipo === corpo.tipo && !antes.has(i.id));
    return item && ['concluido', 'erro', 'cancelado'].includes(item.estado) ? item : null;
  }, { oQue: `download de ${corpo.itens[0].url}` });
}

async function itemDaFila(url) {
  const f = await app.get('/fila');
  return f.itens.find((i) => i.url === url);
}

test('analisa um link direto de vídeo', opcoes, async () => {
  const r = await app.post('/analisar', { url: `${site.url}/video.mp4` });
  assert.equal(r.ok, true, r.erro);
  assert.equal(r.resultado.tipo, 'midia');
  assert.equal(r.resultado.temVideo, true);
});

test('vários links colados viram uma lista', opcoes, async () => {
  const r = await app.post('/analisar', { url: `${site.url}/video.mp4\n${site.url}/video-grande.mp4` });
  assert.equal(r.resultado.tipo, 'links');
  assert.equal(r.resultado.quantidade, 2);
});

test('baixa vídeo MP4 sem reconverter e organiza na pasta', opcoes, async () => {
  const item = await baixar({ tipo: 'video', qualidade: 'max', formatoVideo: 'mp4', itens: [{ url: `${site.url}/video.mp4` }] });
  assert.equal(item.estado, 'concluido', item.erro || '');
  assert.equal(item.arquivo, pasta('Vídeos', 'Outros', 'video.mp4'), 'sem canal: pasta "Outros"');
  assert.deepEqual(apoio.codecs(item.arquivo).sort(), ['audio:aac', 'video:h264']);
  assert.ok(item.tamanho > 10000);
  // a data do arquivo é a do download, não a do vídeo (--no-mtime)
  assert.ok(Date.now() - fs.statSync(item.arquivo).mtimeMs < 5 * 60 * 1000);

  const h = await app.get('/historico');
  assert.ok(h.itens.some((r) => r.arquivo === item.arquivo && r.existe));
});

test('baixa só o áudio em MP3', opcoes, async () => {
  const item = await baixar({ tipo: 'audio', formatoAudio: 'mp3', itens: [{ url: `${site.url}/video.mp4` }] });
  assert.equal(item.estado, 'concluido', item.erro || '');
  assert.equal(item.arquivo, pasta('Músicas', 'Desconhecido', 'video.mp3'), 'sem artista: pasta "Desconhecido"');
  assert.deepEqual(apoio.codecs(item.arquivo), ['audio:mp3']);
  assert.equal(item.formato, 'MP3');
});

test('áudio original não converte (sai o AAC do vídeo, em M4A)', opcoes, async () => {
  const item = await baixar({ tipo: 'audio', formatoAudio: 'original', itens: [{ url: `${site.url}/video.mp4?original` }] });
  assert.equal(item.estado, 'concluido', item.erro || '');
  assert.equal(path.extname(item.arquivo), '.m4a');
  assert.deepEqual(apoio.codecs(item.arquivo), ['audio:aac']);
});

test('item de playlist vai para a pasta da playlist, numerado', opcoes, async () => {
  const item = await baixar({
    tipo: 'video', qualidade: '720', formatoVideo: 'mkv',
    grupo: { id: 'PL', titulo: 'Minha: Lista?', quantidade: 12 },
    itens: [{ url: `${site.url}/video.mp4?lista`, indice: 3 }],
  });
  assert.equal(item.estado, 'concluido', item.erro || '');
  assert.equal(item.arquivo, pasta('Vídeos', 'Minha Lista', '03 - video.mkv'));
});

test('pausa, continua de onde parou e termina inteiro', opcoes, async () => {
  const url = `${site.url}/lento/video-grande.mp4`;
  const r = await app.post('/baixar', { tipo: 'video', qualidade: 'max', formatoVideo: 'mp4', itens: [{ url }] });
  assert.equal(r.adicionados, 1);
  await apoio.esperar(async () => {
    const i = await itemDaFila(url);
    return i && i.estado === 'baixando' && i.progresso && i.progresso.pct > 5;
  }, { oQue: 'começar a baixar' });

  let item = await itemDaFila(url);
  await app.post(`/fila/${item.id}/pausar`);
  item = await itemDaFila(url);
  assert.equal(item.estado, 'pausado');
  assert.ok(apoio.listar(pasta('Vídeos')).some((f) => f.endsWith('.part')), 'o pedaço baixado fica guardado');

  await app.post(`/fila/${item.id}/retomar`);
  item = await apoio.esperar(async () => {
    const i = await itemDaFila(url);
    return i && ['concluido', 'erro'].includes(i.estado) ? i : null;
  }, { oQue: 'terminar depois de continuar' });
  assert.equal(item.estado, 'concluido', item.erro || '');
  assert.deepEqual(apoio.codecs(item.arquivo).sort(), ['audio:aac', 'video:h264']);
  assert.ok(!apoio.listar(pasta('Vídeos')).some((f) => f.endsWith('.part')));
});

test('cancelar apaga os pedaços e não deixa lixo na pasta', opcoes, async () => {
  const url = `${site.url}/lento/video-grande.mp4?cancelar`;
  await app.post('/baixar', { tipo: 'video', qualidade: 'max', formatoVideo: 'mp4', pasta: pasta('Cancelados'), itens: [{ url }] });
  await apoio.esperar(async () => {
    const i = await itemDaFila(url);
    return i && i.progresso && i.progresso.pct > 5;
  }, { oQue: 'começar a baixar' });
  const item = await itemDaFila(url);
  await app.post(`/fila/${item.id}/cancelar`);
  assert.equal((await itemDaFila(url)).estado, 'cancelado');
  assert.deepEqual(apoio.listar(pasta('Cancelados')), []);
});

test('link quebrado vira erro em português', opcoes, async () => {
  const item = await baixar({ tipo: 'video', itens: [{ url: `${site.url}/nao-existe.mp4` }] });
  assert.equal(item.estado, 'erro');
  assert.match(item.erro, /404|não/i);
  assert.ok(item.detalhe, 'guarda a mensagem original para quem quiser ver');
});

test('a mesma coisa duas vezes na fila não duplica', opcoes, async () => {
  const url = `${site.url}/lento/video-grande.mp4?repetido`;
  const corpo = { tipo: 'video', pasta: pasta('Repetidos'), itens: [{ url }] };
  const a = await app.post('/baixar', corpo);
  const b = await app.post('/baixar', corpo);
  assert.equal(a.adicionados, 1);
  assert.equal(b.adicionados, 0);
  assert.equal(b.repetidos, 1);
  const item = await itemDaFila(url);
  await app.post(`/fila/${item.id}/cancelar`);
});

test('outros sites abertos no navegador não conseguem usar o SalvaTudo', opcoes, async () => {
  const porta = new URL(app.base).port;
  // o fetch não deixa trocar o Host; vai pelo http cru
  const statusComHost = await new Promise((ok, erro) => {
    require('http').get({ host: '127.0.0.1', port: porta, path: '/api/sistema', headers: { Host: 'evil.example' } }, (r) => { r.resume(); ok(r.statusCode); }).on('error', erro);
  });
  assert.equal(statusComHost, 403, 'nome de outro site (DNS rebinding)');
  const deFora = await fetch(`${app.base}/api/baixar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://site-malicioso.com' }, body: '{}',
  });
  assert.equal(deFora.status, 403, 'pedido vindo de outra origem');
  const formulario = await fetch(`${app.base}/api/config`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(formulario.status, 415, 'formulário disfarçado');
  const daJanela = await fetch(`${app.base}/api/sistema`, { headers: { Origin: `http://127.0.0.1:${porta}` } });
  assert.equal(daJanela.status, 200);
});

test('configuração inválida é ignorada', opcoes, async () => {
  const r = await app.put('/config', { simultaneos: 99, pastaVideos: 'relativa/nao', organizarVideos: 'xyz', limiteVelocidade: 2 });
  assert.equal(r.config.simultaneos, 2);
  assert.equal(r.config.pastaVideos, pasta('Vídeos'));
  assert.equal(r.config.organizarVideos, 'canal');
  assert.equal(r.config.limiteVelocidade, 2);
  await app.put('/config', { limiteVelocidade: 0 });
});
