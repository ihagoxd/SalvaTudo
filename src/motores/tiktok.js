'use strict';

/**
 * Posts de fotos do TikTok (carrossel, "modo foto" e Live Photos).
 *
 * O yt-dlp só baixa a música desses posts, então o SalvaTudo lê a página
 * do post direto: cada foto vem no arquivo original, sem a marca d'água do
 * TikTok, e a música vem junto. Live Photos trazem também o vídeo curto.
 *
 * A página do TikTok às vezes responde com um desafio anti-robô (uma conta de
 * SHA-256); ele é resolvido aqui mesmo, igual o navegador faria.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { nomeSeguro } = require('../nucleo/util');

const AGENTE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

const ehTikTok = (url) => {
  try { return /(^|\.)tiktok\.com$/i.test(new URL(url).hostname); } catch (_) { return false; }
};

/* ---------------- página do post ---------------- */

/** Biscoitos de uma visita: o TikTok devolve uns e espera de volta. */
class Biscoitos {
  constructor(iniciais = '') {
    /** @type {Map<string, string>} */
    this.mapa = new Map();
    for (const par of String(iniciais).split(/;\s*/)) {
      const i = par.indexOf('=');
      if (i > 0) this.mapa.set(par.slice(0, i), par.slice(i + 1));
    }
  }

  guardar(resposta) {
    for (const c of resposta.headers.getSetCookie()) {
      const [par] = c.split(';');
      const i = par.indexOf('=');
      if (i > 0) this.mapa.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
  }

  cabecalho() {
    return [...this.mapa].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function buscar(url, biscoitos) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': AGENTE,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
      Cookie: biscoitos.cabecalho(),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  biscoitos.guardar(r);
  return { html: await r.text(), url: r.url, status: r.status };
}

const atributo = (html, id) => (new RegExp(`<p[^>]*\\bid="${id}"[^>]*\\bclass="([^"]*)"`).exec(html) || [])[1] || '';

/** A conta anti-robô: achar o número que completa o SHA-256 pedido. */
function resolverDesafio(html, biscoitos) {
  const codificado = atributo(html, 'cs');
  if (!codificado) return false;
  const dados = JSON.parse(Buffer.from(codificado, 'base64').toString('utf8'));
  const esperado = Buffer.from(dados.v.c, 'base64');
  const base = Buffer.from(dados.v.a, 'base64');
  for (let i = 0; i <= 1_000_000; i += 1) {
    if (crypto.createHash('sha256').update(base).update(String(i)).digest().equals(esperado)) {
      dados.d = Buffer.from(String(i)).toString('base64');
      biscoitos.mapa.set(atributo(html, 'wci') || '_wafchallengeid', Buffer.from(JSON.stringify(dados)).toString('base64'));
      const nomeRci = atributo(html, 'rci');
      const valorRci = atributo(html, 'rs');
      if (nomeRci && valorRci) biscoitos.mapa.set(nomeRci, valorRci);
      return true;
    }
  }
  return false;
}

function dadosDaPagina(html) {
  const m = /<script[^>]+id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]).__DEFAULT_SCOPE__ || null; } catch (_) { return null; }
}

const ERROS_STATUS = {
  10204: 'Esse post do TikTok não existe mais.',
  10216: 'Esse post do TikTok é privado.',
  10222: 'Essa conta do TikTok é privada.',
  10101: 'O TikTok bloqueou esse post.',
};

/**
 * Lê um post do TikTok (vídeo ou fotos).
 * @param {string} url  link do post (inclusive vm.tiktok.com e /photo/)
 * @param {{cookies?: string}} [op]  cookies da conta conectada ("a=1; b=2")
 * @returns {Promise<{id: string, autor: string, item: any}>}
 */
async function lerPost(url, { cookies = '' } = {}) {
  const biscoitos = new Biscoitos(cookies);
  let destino = url;
  // links curtos (vm.tiktok.com/xyz) levam ao post de verdade
  if (!/\/(?:video|photo)\/\d+/.test(destino)) destino = (await buscar(destino, biscoitos)).url;
  const m = /\/@([^/?#]*)\/(?:video|photo)\/(\d+)/.exec(destino) || /\/(?:video|photo)\/(\d+)/.exec(destino);
  if (!m) throw new Error('Esse link do TikTok não aponta para um post.');
  const id = m.length === 3 ? m[2] : m[1];
  const usuario = m.length === 3 ? m[1] : '_';

  // a página /photo/ não traz os dados; a /video/ do mesmo número traz (para fotos também)
  const pagina = `https://www.tiktok.com/@${usuario || '_'}/video/${id}`;
  let r = await buscar(pagina, biscoitos);
  let dados = dadosDaPagina(r.html);
  if (!dados && resolverDesafio(r.html, biscoitos)) {
    r = await buscar(pagina, biscoitos);
    dados = dadosDaPagina(r.html);
  }
  if (/\/login/.test(new URL(r.url).pathname)) throw new Error('O TikTok pediu login para ver esse post. Conecte sua conta em Configurações.');
  if (!dados) throw new Error('O TikTok não respondeu como esperado. Tente de novo em instantes.');
  const detalhe = dados['webapp.video-detail'] || {};
  const status = detalhe.statusCode || 0;
  if (status) throw new Error(ERROS_STATUS[status] || `O TikTok não liberou esse post (código ${status}).`);
  const item = detalhe.itemInfo && detalhe.itemInfo.itemStruct;
  if (!item) throw new Error('Não achei o post nessa página do TikTok.');
  return { id, autor: (item.author && item.author.uniqueId) || usuario, item };
}

/* ---------------- fotos ---------------- */

const temFotos = (item) => Boolean(item && item.imagePost && Array.isArray(item.imagePost.images) && item.imagePost.images.length);

/** Links de vídeo escondidos numa foto (Live Photo). O formato muda; procura onde estiver. */
function videosDaFoto(foto) {
  const achados = [];
  const visitar = (valor, chave, fundo) => {
    if (fundo > 6 || valor == null) return;
    if (typeof valor === 'string') {
      if (/^https?:\/\//.test(valor) && (/video|live/i.test(chave) || /mime_type=video|\/video\/tos\//i.test(valor))
        && !/photomode-image|tplv-/.test(valor)) achados.push(valor);
      return;
    }
    if (Array.isArray(valor)) { valor.forEach((v) => visitar(v, chave, fundo + 1)); return; }
    if (typeof valor === 'object') {
      for (const [k, v] of Object.entries(valor)) {
        if (k === 'imageURL') continue;
        visitar(v, `${chave}.${k}`, fundo + 1);
      }
    }
  };
  visitar(foto, '', 0);
  return [...new Set(achados)];
}

/** Título curto e limpo para o nome da pasta: a legenda sem as hashtags. */
function tituloDoPost(item, autor) {
  const legenda = String(item.desc || '').replace(/#[^\s#]+/g, '').replace(/\s+/g, ' ').trim();
  return legenda ? legenda.slice(0, 80) : `Fotos de @${autor}`;
}

/** Resumo para a tela, no mesmo estilo da análise do yt-dlp. */
function resumirFotos(url, id, autor, item) {
  const fotos = item.imagePost.images.map((f, i) => ({
    indice: i + 1,
    url: ((f.imageURL && f.imageURL.urlList) || [])[0] || null,
    largura: f.imageWidth || null,
    altura: f.imageHeight || null,
    live: videosDaFoto(f).length > 0,
  }));
  const musica = item.music && item.music.playUrl ? {
    titulo: item.music.title || null,
    autor: item.music.authorName || null,
    duracao: item.music.duration || null,
  } : null;
  return {
    tipo: 'fotos',
    url,
    id,
    chave: `tiktok:${id}`,
    titulo: tituloDoPost(item, autor),
    canal: `@${autor}`,
    site: 'TikTok',
    miniatura: fotos[0] && fotos[0].url,
    fotos,
    musica,
    lives: fotos.filter((f) => f.live).length,
  };
}

/**
 * Baixa um arquivo tentando os links alternativos (o TikTok manda dois ou mais).
 * @param {string[]} links
 * @param {string} destino
 * @param {(bytes: number) => void} aoReceber
 * @param {AbortSignal} sinal
 */
async function baixarUm(links, destino, aoReceber, sinal) {
  let ultimo = null;
  for (const link of links) {
    try {
      const r = await fetch(link, { headers: { 'User-Agent': AGENTE, Referer: 'https://www.tiktok.com/' }, signal: sinal });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const temporario = `${destino}.part`;
      const saida = fs.createWriteStream(temporario);
      try {
        for await (const pedaco of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (r.body))) {
          if (!saida.write(pedaco)) await new Promise((ok) => saida.once('drain', () => ok(undefined)));
          aoReceber(pedaco.length);
        }
      } finally {
        await new Promise((ok) => saida.end(() => ok(undefined)));
      }
      await fsp.rename(temporario, destino);
      return;
    } catch (err) {
      if (sinal.aborted) throw err;
      ultimo = err;
    }
  }
  throw ultimo || new Error('Sem link para baixar.');
}

/** Extensão pelo começo do arquivo (o TikTok às vezes manda WebP com nome .jpeg). */
async function ajustarExtensao(arquivo) {
  const fd = await fsp.open(arquivo, 'r');
  const cabeca = Buffer.alloc(12);
  await fd.read(cabeca, 0, 12, 0);
  await fd.close();
  let ext = null;
  if (cabeca.slice(0, 3).toString('hex') === 'ffd8ff') ext = '.jpg';
  else if (cabeca.slice(0, 4).toString('ascii') === 'RIFF' && cabeca.slice(8, 12).toString('ascii') === 'WEBP') ext = '.webp';
  else if (cabeca.slice(1, 4).toString('ascii') === 'PNG') ext = '.png';
  else if (cabeca.slice(4, 8).toString('ascii') === 'ftyp') ext = /heic|heix|mif1/.test(cabeca.slice(8, 12).toString('ascii')) ? '.heic' : '.mp4';
  if (!ext || path.extname(arquivo).toLowerCase() === ext) return arquivo;
  const novo = arquivo.replace(/\.[^.\\/]+$/, '') + ext;
  await fsp.rename(arquivo, novo);
  return novo;
}

/** "nome.jpg" livre na pasta: se já existe, vira "nome (2).jpg". */
function livre(arquivo) {
  if (!fs.existsSync(arquivo)) return arquivo;
  const ext = path.extname(arquivo);
  const base = arquivo.slice(0, arquivo.length - ext.length);
  for (let n = 2; ; n += 1) {
    const alvo = `${base} (${n})${ext}`;
    if (!fs.existsSync(alvo)) return alvo;
  }
}

/**
 * Baixa as fotos do post (e a música e as Live Photos, se pedido).
 * Pasta: <base>/@autor/<legenda>/01.jpg, 02.jpg... ; post com uma foto só
 * vira <base>/@autor/<legenda>.jpg.
 * @param {string} url
 * @param {{pasta: string, musica: boolean, lives: boolean, cookies?: string}} pedido
 * @param {{aoInfo?: (info: any) => void, aoProgresso?: (p: {pct: number, baixado: number, total: number | null, etapa: string}) => void, sinal: AbortSignal}} ganchos
 * @returns {Promise<{arquivo: string, arquivos: string[], tamanho: number, jaExistia: boolean}>}
 */
async function baixarFotos(url, pedido, { aoInfo, aoProgresso, sinal }) {
  // os links das fotos vencem em poucos dias: lê o post de novo na hora de baixar
  const { id, autor, item } = await lerPost(url, { cookies: pedido.cookies });
  if (!temFotos(item)) throw new Error('Esse post do TikTok não tem fotos.');
  const resumo = resumirFotos(url, id, autor, item);
  if (aoInfo) aoInfo(resumo);

  const fotos = item.imagePost.images;
  const titulo = nomeSeguro(resumo.titulo, 80) || id;
  const pastaAutor = path.join(pedido.pasta, nomeSeguro(`@${autor}`, 60) || '@tiktok');
  const unica = fotos.length === 1 && !pedido.musica;
  const destino = unica ? pastaAutor : path.join(pastaAutor, titulo);
  await fsp.mkdir(destino, { recursive: true });

  /** @type {{links: string[], arquivo: string, etapa: string}[]} */
  const tarefas = [];
  const digitos = Math.max(2, String(fotos.length).length);
  fotos.forEach((f, i) => {
    const n = String(i + 1).padStart(digitos, '0');
    const links = (f.imageURL && f.imageURL.urlList) || [];
    if (!links.length) return;
    tarefas.push({ links, arquivo: unica ? path.join(destino, `${titulo}.jpg`) : path.join(destino, `${n}.jpg`), etapa: `Foto ${i + 1} de ${fotos.length}` });
    if (pedido.lives) {
      const videos = videosDaFoto(f);
      if (videos.length) tarefas.push({ links: videos, arquivo: path.join(destino, `${n} (Live).mp4`), etapa: `Live Photo ${i + 1}` });
    }
  });
  if (pedido.musica && item.music && item.music.playUrl) {
    const nomeMusica = nomeSeguro([item.music.authorName, item.music.title].filter(Boolean).join(' - '), 100) || 'Música';
    tarefas.push({ links: [item.music.playUrl], arquivo: path.join(destino, `${nomeMusica}.mp3`), etapa: 'Música' });
  }

  const arquivos = [];
  let baixado = 0;
  for (let i = 0; i < tarefas.length; i += 1) {
    if (sinal.aborted) throw new Error('cancelado');
    const t = tarefas[i];
    const alvo = livre(t.arquivo);
    const pctBase = (i / tarefas.length) * 100;
    if (aoProgresso) aoProgresso({ pct: pctBase, baixado, total: null, etapa: t.etapa });
    await baixarUm(t.links, alvo, (bytes) => { baixado += bytes; }, sinal);
    arquivos.push(t.etapa === 'Música' ? alvo : await ajustarExtensao(alvo));
  }
  if (aoProgresso) aoProgresso({ pct: 100, baixado, total: baixado, etapa: 'Pronto' });
  return { arquivo: unica ? arquivos[0] : destino, arquivos, tamanho: baixado, jaExistia: false };
}

module.exports = { ehTikTok, lerPost, temFotos, resumirFotos, baixarFotos, resolverDesafio, videosDaFoto };
