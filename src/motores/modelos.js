'use strict';

/**
 * Como cada pedido vira argumentos do yt-dlp, como as linhas que ele escreve
 * viram progresso e como os erros dele viram frases em português.
 * Tudo aqui é puro (sem processos nem disco) para poder ser testado à parte.
 *
 * Qualidade: nada é reconvertido sem necessidade. O vídeo e o áudio originais
 * são baixados e só "empacotados" juntos (MP4 ou MKV). Só há conversão quando
 * a pessoa pede um formato de áudio diferente do original (MP3, FLAC...).
 */

const { escaparModelo } = require('../nucleo/util');

/**
 * O que a pessoa escolheu para um item. Fica guardado junto do item na fila,
 * então mudar as configurações depois não mexe no que já foi pedido.
 * @typedef {object} Pedido
 * @property {'video' | 'audio' | 'fotos'} tipo
 * @property {string} qualidade        'max' ou a altura máxima ('1080', '720'...)
 * @property {'mp4' | 'mkv'} formatoVideo
 * @property {'original' | 'm4a' | 'mp3' | 'flac'} formatoAudio
 * @property {string} pasta            pasta base (absoluta)
 * @property {string} [subpasta]       nome da playlist (pasta própria) ou vazio
 * @property {number} [indice]         posição na playlist, para numerar
 * @property {number} [totalLista]     tamanho da playlist (quantos zeros na numeração)
 * @property {string} organizar        'canal' | 'site' | 'data' | 'nenhuma' | 'artista-album' | 'artista'
 * @property {boolean} legendas
 * @property {boolean} capaQuadrada
 * @property {boolean} [musica]       fotos do TikTok: baixar a música junto
 * @property {boolean} [lives]        fotos do TikTok: baixar o vídeo das Live Photos
 */

/* ---------------- formato e qualidade ---------------- */

/** @param {Pedido} p */
function argsFormato(p) {
  if (p.tipo === 'audio') {
    const a = [];
    if (p.formatoAudio === 'm4a') {
      // AAC original quando o site oferece (YouTube oferece): sem reconverter
      a.push('-f', 'ba[acodec^=mp4a]/ba/b', '-x', '--audio-format', 'm4a');
    } else if (p.formatoAudio === 'mp3') {
      a.push('-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '320K');
    } else if (p.formatoAudio === 'flac') {
      a.push('-f', 'ba/b', '-x', '--audio-format', 'flac');
    } else {
      // o melhor áudio do site, do jeito que ele é (Opus, AAC...)
      a.push('-f', 'ba/b', '-x');
    }
    return a;
  }

  const res = /^\d{3,4}$/.test(p.qualidade) ? `res:${p.qualidade}` : 'res';
  if (p.formatoVideo === 'mkv') {
    // máxima qualidade: o melhor codec de cada resolução, HDR quando houver
    // arquivo que já vem pronto (Instagram, TikTok...) também vira MKV: só troca a "caixa", sem perda
    return ['-f', 'bv*+ba/b', '-S', res, '--merge-output-format', 'mkv', '--remux-video', 'mkv'];
  }
  // MP4 que abre em qualquer lugar: na mesma resolução, prefere H.264 + AAC
  // e imagem SDR. Acima de 1080p o YouTube só tem VP9/AV1, que vão no MP4 também.
  return ['-f', 'bv*+ba/b', '-S', `${res},fps,hdr:SDR,vcodec:h264,acodec:aac`, '--merge-output-format', 'mp4/mkv'];
}

/* ---------------- pastas e nomes ---------------- */

// sem título (post só com hashtags): o número do post, que nunca repete
const TITULO = '%(title,id)s.%(ext)s';
const CANAL = '%(channel,uploader,creator|Outros)s';
const ARTISTA = '%(artist,creator,uploader,channel|Desconhecido)s';

/**
 * Caminho do arquivo dentro da pasta base, no formato de modelo do yt-dlp.
 * Pastas vazias somem sozinhas: sem álbum, a música fica direto na pasta do artista.
 * @param {Pedido} p
 */
function modeloSaida(p) {
  if (p.subpasta) {
    let prefixo = '';
    if (p.indice) {
      const digitos = Math.max(2, String(p.totalLista || p.indice).length);
      prefixo = `${String(p.indice).padStart(digitos, '0')} - `;
    }
    return `${escaparModelo(p.subpasta)}/${prefixo}${TITULO}`;
  }
  if (p.tipo === 'audio') {
    if (p.organizar === 'artista-album') return `${ARTISTA}/%(album|)s/${TITULO}`;
    if (p.organizar === 'artista') return `${ARTISTA}/${TITULO}`;
    return TITULO;
  }
  if (p.organizar === 'canal') return `${CANAL}/${TITULO}`;
  if (p.organizar === 'site') return `%(extractor_key|Outros)s/${CANAL}/${TITULO}`;
  if (p.organizar === 'data') return `%(epoch>%Y-%m)s/${TITULO}`;
  return TITULO;
}

/** Capa recortada no quadrado, como a de um álbum. */
const RECORTE_QUADRADO = 'ThumbnailsConvertor+FFmpeg_o:-c:v mjpeg -qmin 1 -qscale:v 1 '
  + '-vf crop="\'if(gt(ih,iw),iw,ih)\':\'if(gt(iw,ih),ih,iw)\'"';

/** @param {Pedido} p */
function argsExtras(p) {
  const a = [
    // nome limpo: legendas de TikTok/Instagram vêm cheias de #hashtags e cortadas com "..."
    '--replace-in-metadata', 'title', String.raw`\s*#[^\W\d_][\w.]*`, '',
    '--replace-in-metadata', 'title', String.raw`[\s.…]+$`, '',
    '--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg',
  ];
  if (p.tipo === 'audio') {
    if (p.capaQuadrada) a.push('--ppa', RECORTE_QUADRADO);
    // número da faixa = posição na playlist, para tocar na ordem certa
    if (p.subpasta && p.indice) a.push('--parse-metadata', `${p.indice}:%(track_number)s`);
  } else {
    a.push('--embed-chapters');
    if (p.legendas) a.push('--write-subs', '--write-auto-subs', '--sub-langs', 'pt-BR,pt,pt-orig', '--embed-subs');
  }
  return a;
}

/* ---------------- linha de comando completa ---------------- */

/**
 * @typedef {object} Ambiente
 * @property {string} [dirFfmpeg]
 * @property {string} dirCache
 * @property {string} motorJs           executável que roda JavaScript (Node ou o próprio Electron)
 * @property {string} [loginNavegador]  usar os cookies deste navegador
 * @property {number} [limiteVelocidade] MB/s
 */

/** @param {Ambiente} amb */
function argsComuns(amb) {
  const a = [
    '--ignore-config', // a configuração pessoal de quem já usa o yt-dlp não interfere
    '--encoding', 'utf-8',
    '--color', 'never',
    // o YouTube exige um motor de JavaScript; o Node (ou o Electron) serve
    '--js-runtimes', `node:${amb.motorJs}`,
    '--cache-dir', amb.dirCache,
    '--socket-timeout', '30',
  ];
  if (amb.dirFfmpeg) a.push('--ffmpeg-location', amb.dirFfmpeg);
  if (amb.loginNavegador) a.push('--cookies-from-browser', amb.loginNavegador);
  return a;
}

/**
 * Lê as informações sem baixar. Playlists vêm "achatadas" (só a lista), que é rápido.
 * @param {string} url
 * @param {Ambiente} amb
 * @param {{playlist?: boolean}} [op]
 */
function argsAnalise(url, amb, { playlist = false } = {}) {
  return [...argsComuns(amb), '-J', '--flat-playlist', playlist ? '--yes-playlist' : '--no-playlist', '--', url];
}

// Linhas que o yt-dlp escreve para o SalvaTudo acompanhar o download.
const MODELO_PROGRESSO = 'download:MBP|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s'
  + '|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s|%(progress.filename)j';
const MODELO_ETAPA = 'postprocess:MBPP|%(progress.status)s|%(progress.postprocessor)s';
const IMPRIMIR_INFO = 'before_dl:MBINFO|%(.{id,title,thumbnail,channel,uploader,artist,album,duration,extractor_key,webpage_url,ext,width,height})j';
const IMPRIMIR_FORMATOS = 'before_dl:MBFMT|%(requested_formats.:.{format_id,filesize,filesize_approx})j|%(format_id)j|%(filesize,filesize_approx)j';
const IMPRIMIR_FIM = 'after_move:MBFIM|%(filepath)j';

/**
 * @param {string} url
 * @param {Pedido} p
 * @param {Ambiente} amb
 */
function argsDownload(url, p, amb) {
  const a = [
    ...argsComuns(amb),
    '--newline', '--progress',
    '--progress-template', MODELO_PROGRESSO,
    '--progress-template', MODELO_ETAPA,
    '--print', IMPRIMIR_INFO,
    '--print', IMPRIMIR_FORMATOS,
    '--print', IMPRIMIR_FIM,
    '--no-playlist',
    '--no-mtime',             // a data do arquivo é a do download, não a do vídeo
    '--trim-filenames', '150', // nomes enormes estouram o limite de caminho do Windows
    '--concurrent-fragments', '4',
  ];
  if (amb.limiteVelocidade) a.push('--limit-rate', `${amb.limiteVelocidade}M`);
  a.push(...argsFormato(p), ...argsExtras(p), '-P', p.pasta, '-o', modeloSaida(p), '--', url);
  return a;
}

/* ---------------- leitura das linhas ---------------- */

function numero(texto) {
  if (texto == null || texto === 'NA' || texto === 'None' || texto === '') return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

function json(texto) {
  try { return JSON.parse(texto); } catch (_) { return null; }
}

/**
 * Transforma uma linha da saída do yt-dlp num evento.
 * @param {string} linha
 * @returns {null | {tipo: 'info', info: any} | {tipo: 'formatos', formatos: {id: string, tamanho: number | null}[]}
 *   | {tipo: 'progresso', status: string, baixado: number | null, total: number | null, velocidade: number | null,
 *      eta: number | null, formato: string, arquivo: string | null}
 *   | {tipo: 'etapa', status: string, processador: string} | {tipo: 'fim', arquivo: string}}
 */
function lerLinha(linha) {
  const i = linha.indexOf('|');
  if (i < 0) return null;
  const prefixo = linha.slice(0, i);
  const resto = linha.slice(i + 1);
  if (prefixo === 'MBP') {
    const partes = resto.split('|');
    const [status, baixado, total, estimado, velocidade, eta, formato] = partes;
    return {
      tipo: 'progresso',
      status,
      baixado: numero(baixado),
      total: numero(total) || numero(estimado),
      velocidade: numero(velocidade),
      eta: numero(eta),
      formato: formato || '',
      arquivo: json(partes.slice(7).join('|')),
    };
  }
  if (prefixo === 'MBPP') {
    const [status, processador] = resto.split('|');
    return { tipo: 'etapa', status, processador: processador || '' };
  }
  if (prefixo === 'MBINFO') {
    const info = json(resto);
    return info && typeof info === 'object' ? { tipo: 'info', info } : null;
  }
  if (prefixo === 'MBFMT') {
    const [pedidos, unico, tamanhoUnico] = resto.split('|').map(json);
    const lista = Array.isArray(pedidos) && pedidos.length
      ? pedidos.map((f) => ({ id: String(f.format_id), tamanho: f.filesize || f.filesize_approx || null }))
      : [{ id: String(unico || ''), tamanho: typeof tamanhoUnico === 'number' ? tamanhoUnico : null }];
    return { tipo: 'formatos', formatos: lista };
  }
  if (prefixo === 'MBFIM') {
    const arquivo = json(resto);
    return typeof arquivo === 'string' ? { tipo: 'fim', arquivo } : null;
  }
  return null;
}

/* ---------------- andamento geral ---------------- */

/**
 * Junta o progresso das partes (vídeo e áudio vêm separados) num número só.
 */
class Andamento {
  constructor() {
    /** @type {{id: string, tamanho: number | null}[]} */
    this.esperados = [];
    /** @type {Map<string, {baixado: number, total: number | null, terminou: boolean}>} */
    this.partes = new Map();
    this.velocidade = null;
    this.eta = null;
    this.atual = '';
  }

  /** @param {{id: string, tamanho: number | null}[]} formatos */
  definirFormatos(formatos) {
    this.esperados = formatos.filter((f) => f.id);
  }

  /** @param {{status: string, baixado: number | null, total: number | null, velocidade: number | null, eta: number | null, formato: string}} p */
  registrar(p) {
    const id = p.formato || this.atual || '?';
    this.atual = id;
    const parte = this.partes.get(id) || { baixado: 0, total: null, terminou: false };
    if (p.baixado != null) parte.baixado = p.baixado;
    if (p.total) parte.total = p.total;
    if (p.status === 'finished') {
      parte.terminou = true;
      if (!parte.total) parte.total = parte.baixado;
      parte.baixado = parte.total || parte.baixado;
    }
    this.partes.set(id, parte);
    if (p.status === 'downloading') {
      this.velocidade = p.velocidade;
      this.eta = p.eta;
    }
  }

  /** Porcentagem (0 a 100), bytes e velocidade de tudo junto. */
  resumo() {
    const ids = this.esperados.length ? this.esperados.map((e) => e.id) : [...this.partes.keys()];
    const n = Math.max(1, ids.length);
    const totais = ids.map((id) => {
      const parte = this.partes.get(id);
      const esperado = this.esperados.find((e) => e.id === id);
      return (parte && parte.total) || (esperado && esperado.tamanho) || null;
    });
    const baixados = ids.map((id) => (this.partes.get(id) || { baixado: 0 }).baixado);
    const conhecidos = totais.every((t) => t);
    let pct;
    let total = null;
    let baixado = baixados.reduce((s, b) => s + b, 0);
    if (conhecidos && ids.length) {
      total = totais.reduce((s, t) => s + t, 0);
      baixado = baixados.reduce((s, b, i) => s + Math.min(b, totais[i]), 0);
      pct = total ? (baixado / total) * 100 : 0;
    } else {
      pct = (ids.reduce((s, id, i) => {
        const parte = this.partes.get(id);
        if (!parte) return s;
        if (parte.terminou) return s + 1;
        return s + (totais[i] ? Math.min(1, parte.baixado / totais[i]) : 0);
      }, 0) / n) * 100;
    }
    const tudoTerminou = ids.length > 0 && ids.every((id) => (this.partes.get(id) || { terminou: false }).terminou);
    let eta = this.eta;
    if (total && this.velocidade && !tudoTerminou) eta = Math.max(0, (total - baixado) / this.velocidade);
    return {
      pct: Math.max(0, Math.min(tudoTerminou ? 100 : 99.5, pct)),
      baixado,
      total,
      velocidade: tudoTerminou ? null : this.velocidade,
      eta: tudoTerminou ? null : eta,
      parte: ids.length > 1 ? { atual: Math.max(1, ids.indexOf(this.atual) + 1), de: ids.length } : null,
    };
  }
}

/* ---------------- etapas depois do download ---------------- */

const ETAPAS = {
  Merger: 'Juntando vídeo e áudio',
  ExtractAudio: 'Separando o áudio',
  EmbedThumbnail: 'Colocando a capa',
  Metadata: 'Gravando título e artista',
  EmbedSubtitle: 'Colocando as legendas',
  MoveFiles: 'Guardando na pasta',
  VideoConvertor: 'Convertendo o vídeo',
  VideoRemuxer: 'Trocando o formato',
  ModifyChapters: 'Ajustando os capítulos',
  FixupM3u8: 'Ajustando o arquivo',
  FixupM4a: 'Ajustando o arquivo',
  FixupStretched: 'Ajustando o arquivo',
  FixupDuplicateMoov: 'Ajustando o arquivo',
  FixupTimestamp: 'Ajustando o arquivo',
  FixupDuration: 'Ajustando o arquivo',
};

/**
 * Nome da etapa para a tela, ou null para etapas que acontecem antes do
 * download (preparar capa, ler metadados) e não mudam o estado do item.
 * @param {string} processador
 * @param {Pedido} [p]
 */
function nomeEtapa(processador, p) {
  if (processador === 'ExtractAudio' && p && p.tipo === 'audio') {
    if (p.formatoAudio === 'mp3') return 'Convertendo para MP3';
    if (p.formatoAudio === 'flac') return 'Convertendo para FLAC';
  }
  return ETAPAS[processador] || null;
}

/* ---------------- erros em português ---------------- */

const ERROS = [
  [/Could not copy .*cookie|could not find .*cookies? database|Failed to decrypt with DPAPI|cookies? .*(?:locked|in use)/i,
    'Não consegui ler o login do navegador. Feche o navegador escolhido e tente de novo (o Firefox costuma funcionar melhor).'],
  [/is not a valid URL|Unsupported URL/i, 'Esse link não leva a um vídeo ou música que dê para baixar.'],
  [/DRM/i, 'Esse conteúdo tem proteção contra cópia (DRM) e não pode ser baixado.'],
  [/Private video|This video is private|privat/i, 'Esse vídeo é privado.'],
  [/members[- ]only|Join this channel/i, 'Esse vídeo é exclusivo para membros do canal.'],
  [/confirm your age|age[- ]restricted|inappropriate for some users/i,
    'Esse vídeo tem restrição de idade: só aparece para quem está logado. Conecte sua conta em Configurações.'],
  [/not a bot|confirm you.?re not/i,
    'O site pediu para confirmar que você não é um robô. Espere alguns minutos e tente de novo.'],
  [/live event will begin|Premieres in|will begin in|Premiere will begin/i, 'Essa transmissão ou estreia ainda não começou.'],
  [/not available in your country|geo.?restrict|blocked it in your country/i, 'Esse conteúdo não está liberado no Brasil.'],
  // antes do "limite de pedidos": o Instagram diz "rate-limit reached or login required", e conectar a conta resolve
  [/login required|requires? (?:a )?login|log ?in to|logged[- ]in|use --cookies|account|authentication/i,
    'Esse conteúdo só aparece para quem está logado. Conecte sua conta em Configurações e tente de novo.'],
  [/HTTP Error 429|Too Many Requests|rate.?limit/i, 'O site limitou os downloads por excesso de pedidos. Espere alguns minutos e tente de novo.'],
  [/HTTP Error 403|Forbidden/i, 'O site recusou o download (erro 403). Atualize o yt-dlp em Configurações e tente de novo.'],
  [/HTTP Error 404|Not Found/i, 'Não encontrado (erro 404). Confira se o link está certo.'],
  [/Video unavailable|This video is unavailable|has been removed|no longer available|does not exist|deleted/i,
    'Esse conteúdo não está mais disponível (foi removido ou bloqueado).'],
  [/Requested format is not available/i, 'Essa qualidade não existe para este vídeo. Escolha outra.'],
  [/No video formats found|no (?:suitable )?formats/i, 'Não achei nenhum vídeo ou áudio nesse link.'],
  [/No space left|Errno 28|ENOSPC|not enough space|disk (?:is )?full/i, 'O disco está cheio. Libere espaço ou escolha outra pasta.'],
  [/Permission denied|Errno 13|Access is denied|EACCES|EPERM/i, 'Sem permissão para gravar na pasta escolhida. Escolha outra pasta.'],
  [/File name too long|Errno 36|path too long/i, 'O nome do arquivo ficou longo demais para o Windows. Escolha uma pasta mais curta.'],
  [/ffmpeg|ffprobe|Postprocessing/i, 'O FFmpeg não conseguiu terminar o arquivo. Tente outro formato ou reinstale os componentes em Configurações.'],
  [/getaddrinfo|Name or service not known|Unable to download (?:webpage|API)|timed out|Connection (?:reset|refused|aborted)|Network is unreachable|No route|Temporary failure in name resolution|SSL|EOF occurred/i,
    'Sem conexão com o site. Confira a internet e tente de novo.'],
];

/**
 * @param {string} saidaDeErro  o que o yt-dlp escreveu no stderr
 * @returns {{mensagem: string, detalhe: string}}
 */
function traduzirErro(saidaDeErro) {
  const linhas = String(saidaDeErro || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const erros = linhas.filter((l) => /^ERROR:/.test(l));
  const detalhe = (erros.length ? erros[erros.length - 1] : linhas[linhas.length - 1] || '').replace(/^ERROR:\s*/, '');
  const texto = erros.length ? erros.join('\n') : detalhe;
  for (const [teste, mensagem] of ERROS) {
    if (/** @type {RegExp} */ (teste).test(texto)) return { mensagem: /** @type {string} */ (mensagem), detalhe };
  }
  return { mensagem: 'Não foi possível baixar. Veja o detalhe abaixo.', detalhe };
}

module.exports = {
  argsFormato,
  modeloSaida,
  argsExtras,
  argsComuns,
  argsAnalise,
  argsDownload,
  lerLinha,
  Andamento,
  nomeEtapa,
  traduzirErro,
};
