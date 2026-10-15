'use strict';

/**
 * Os dois programas que fazem o trabalho pesado:
 *  - yt-dlp: entende mais de 1.800 sites e baixa os arquivos originais;
 *  - FFmpeg: junta vídeo e áudio sem reconverter, extrai o áudio e põe a capa.
 *
 * Ficam em dados/componentes. Na primeira vez são baixados das páginas
 * oficiais no GitHub (com conferência do SHA-256), e o yt-dlp se atualiza
 * sozinho, porque os sites mudam o tempo todo. Se já houver um yt-dlp ou um
 * FFmpeg instalado no computador, ele é usado.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { Unzip, UnzipInflate } = require('fflate');

const config = require('../config');
const so = require('./so');
const { lerJson, gravarJson } = require('../nucleo/util');

const DIR = config.pastas.componentes;
const EXE = so.EH_WINDOWS ? '.exe' : '';
const ARQ_YTDLP = path.join(DIR, `yt-dlp${EXE}`);
const DIR_FFMPEG = path.join(DIR, 'ffmpeg');

const FONTES = {
  ytdlp: {
    repo: 'yt-dlp/yt-dlp',
    arquivo: { win32: 'yt-dlp.exe', linux: 'yt-dlp_linux', darwin: 'yt-dlp_macos' }[process.platform],
  },
  ffmpeg: {
    repo: 'yt-dlp/FFmpeg-Builds',
    // versão "shared": metade do tamanho (os dois programas dividem as DLLs)
    arquivo: process.platform === 'win32' ? 'ffmpeg-master-latest-win64-gpl-shared.zip' : null,
  },
};

const HORAS_ENTRE_VERIFICACOES = 20;

/* ---------------- onde está cada programa ---------------- */

function existe(c) {
  try { return fs.statSync(c).isFile(); } catch (_) { return false; }
}

function localizarYtdlp() {
  if (existe(ARQ_YTDLP)) return { caminho: ARQ_YTDLP, proprio: true };
  const env = process.env.SALVATUDO_YTDLP;
  if (env && existe(env)) return { caminho: env, proprio: false };
  const sistema = so.acharPrograma('yt-dlp');
  return sistema ? { caminho: sistema, proprio: false } : null;
}

function localizarFfmpeg() {
  const proprio = path.join(DIR_FFMPEG, `ffmpeg${EXE}`);
  if (existe(proprio) && existe(path.join(DIR_FFMPEG, `ffprobe${EXE}`))) return { caminho: proprio, proprio: true };
  const sistema = so.acharPrograma('ffmpeg');
  if (sistema && existe(path.join(path.dirname(sistema), `ffprobe${EXE}`))) return { caminho: sistema, proprio: false };
  return null;
}

/* ---------------- versões ---------------- */

/** @type {Map<string, string>} */
const versoes = new Map();

/** Primeira linha de "programa --version", guardada enquanto o arquivo não mudar. */
function lerVersao(caminho, args, extrair) {
  let chave;
  try { chave = `${caminho}|${fs.statSync(caminho).mtimeMs}`; } catch (_) { return Promise.resolve(null); }
  if (versoes.has(chave)) return Promise.resolve(versoes.get(chave));
  return new Promise((resolve) => {
    execFile(caminho, args, { windowsHide: true, timeout: 60000, encoding: 'utf8' }, (err, saida) => {
      if (err) { resolve(null); return; }
      const v = extrair(String(saida).split(/\r?\n/)[0].trim());
      if (v) versoes.set(chave, v);
      resolve(v || null);
    });
  });
}

const versaoYtdlp = (c) => lerVersao(c, ['--version'], (l) => l);
const versaoFfmpeg = (c) => lerVersao(c, ['-version'], (l) => {
  const m = /version\s+(\S+)/i.exec(l);
  return m ? m[1].replace(/-www\.gyan\.dev$/, '').slice(0, 32) : null;
});

/* ---------------- estado (o que a tela mostra) ---------------- */

/**
 * @typedef {object} Instalacao
 * @property {string} etapa       texto curto para a tela
 * @property {string} componente  'ytdlp' | 'ffmpeg'
 * @property {number} baixado
 * @property {number} total
 * @property {string} [erro]
 */

/** @type {Instalacao | null} */
let instalando = null;
/** @type {Promise<void> | null} */
let instalacaoAtual = null;
let ultimoErro = '';

const memoria = () => lerJson(config.ARQUIVO_COMPONENTES, /** @type {{ultimaVerificacao?: number, ultimaVersao?: string}} */ ({}));

/** Para quem está na tela: o que existe, as versões e o andamento da instalação. */
async function estado() {
  const yt = localizarYtdlp();
  const ff = localizarFfmpeg();
  const [vYt, vFf] = await Promise.all([yt && versaoYtdlp(yt.caminho), ff && versaoFfmpeg(ff.caminho)]);
  const m = memoria();
  const nova = m.ultimaVersao && vYt && m.ultimaVersao > vYt ? m.ultimaVersao : null;
  return {
    pronto: Boolean(yt && ff && vYt),
    ytdlp: yt ? { ok: Boolean(vYt), versao: vYt, proprio: yt.proprio, caminho: yt.caminho, novaVersao: nova } : { ok: false },
    ffmpeg: ff ? { ok: Boolean(vFf), versao: vFf, proprio: ff.proprio, caminho: ff.caminho } : { ok: false },
    motorJs: { versao: process.versions.node },
    instalando,
    erro: ultimoErro || null,
    ultimaVerificacao: m.ultimaVerificacao || null,
    podeInstalarFfmpeg: Boolean(FONTES.ffmpeg.arquivo),
  };
}

/** Caminhos que o yt-dlp precisa para trabalhar (null se falta algo). */
function caminhos() {
  const yt = localizarYtdlp();
  const ff = localizarFfmpeg();
  if (!yt || !ff) return null;
  return { ytdlp: yt.caminho, ffmpeg: ff.caminho, dirFfmpeg: path.dirname(ff.caminho) };
}

/* ---------------- avisar a tela ---------------- */

/** @type {(dados: any) => void} */
let publicar = () => {};
/** O servidor liga aqui o canal de eventos. */
function aoMudar(fn) { publicar = fn; }

let ultimoAviso = 0;
async function avisar(forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - ultimoAviso < 200) return;
  ultimoAviso = agora;
  try { publicar(await estado()); } catch (_) { /* tela fechada */ }
}

/* ---------------- GitHub ---------------- */

const CABECALHOS = { 'User-Agent': `SalvaTudo/${config.VERSAO}`, Accept: 'application/vnd.github+json' };

/**
 * Última versão publicada de um repositório.
 * @returns {Promise<{tag: string, url: string, tamanho: number, sha256: string | null}>}
 */
async function ultimaVersao(repo, arquivo) {
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: CABECALHOS, signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`);
    const d = await r.json();
    const asset = (d.assets || []).find((a) => a.name === arquivo);
    if (!asset) throw new Error(`${arquivo} não está na versão ${d.tag_name}`);
    const digest = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:') ? asset.digest.slice(7) : null;
    return { tag: d.tag_name, url: asset.browser_download_url, tamanho: asset.size, sha256: digest };
  } catch (err) {
    // Sem a API (limite de consultas, rede corporativa): o link direto da
    // última versão continua valendo, só sem a conferência do SHA-256.
    console.warn('[componentes] API do GitHub indisponível:', err.message);
    return { tag: '', url: `https://github.com/${repo}/releases/latest/download/${arquivo}`, tamanho: 0, sha256: null };
  }
}

/**
 * Baixa para um arquivo, contando os bytes e calculando o SHA-256.
 * @param {string} url
 * @param {string} destino
 * @param {(baixado: number, total: number) => void} aoProgredir
 */
async function baixarArquivo(url, destino, aoProgredir) {
  const r = await fetch(url, { headers: { 'User-Agent': CABECALHOS['User-Agent'] }, redirect: 'follow' });
  if (!r.ok || !r.body) throw new Error(`Download recusado (${r.status}).`);
  const total = Number(r.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  const saida = fs.createWriteStream(destino);
  let baixado = 0;
  try {
    for await (const pedaco of /** @type {AsyncIterable<Uint8Array>} */ (/** @type {unknown} */ (r.body))) {
      hash.update(pedaco);
      baixado += pedaco.length;
      if (!saida.write(pedaco)) await new Promise((ok) => saida.once('drain', () => ok(undefined)));
      aoProgredir(baixado, total);
    }
  } finally {
    await new Promise((ok) => saida.end(() => ok(undefined)));
  }
  if (total && baixado !== total) throw new Error('O download veio incompleto.');
  return hash.digest('hex');
}

/**
 * Extrai do zip só os arquivos escolhidos, aos poucos (sem carregar tudo na memória).
 * @param {string} arquivoZip
 * @param {string} destino
 * @param {(nome: string) => string | null} escolher  nome de saída, ou null para pular
 */
async function extrairZip(arquivoZip, destino, escolher) {
  await fsp.mkdir(destino, { recursive: true });
  /** @type {Promise<void>[]} */
  const terminados = [];
  /** @type {fs.WriteStream[]} */
  const abertos = [];
  /** @type {Error | null} */
  let falha = null;
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.onfile = (arquivo) => {
    const nome = escolher(arquivo.name);
    if (!nome) return;
    const saida = fs.createWriteStream(path.join(destino, nome));
    abertos.push(saida);
    terminados.push(new Promise((ok, erro) => { saida.on('finish', ok); saida.on('error', erro); }));
    arquivo.ondata = (err, dados, final) => {
      if (err) { falha = err; return; }
      saida.write(dados);
      if (final) saida.end();
    };
    arquivo.start();
  };
  for await (const pedaco of fs.createReadStream(arquivoZip, { highWaterMark: 256 * 1024 })) {
    unzip.push(pedaco);
    if (falha) throw falha;
    // segura a leitura enquanto o disco não dá conta de gravar
    const cheio = abertos.find((s) => s.writableNeedDrain);
    if (cheio) await new Promise((ok) => cheio.once('drain', () => ok(undefined)));
  }
  unzip.push(new Uint8Array(0), true);
  if (falha) throw falha;
  await Promise.all(terminados);
}

/* ---------------- instalação ---------------- */

async function apagar(alvo) {
  await fsp.rm(alvo, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
}

/** @param {Instalacao} dados */
function andamento(dados) {
  instalando = dados;
  avisar();
}

async function instalarYtdlp() {
  const fonte = FONTES.ytdlp;
  if (!fonte.arquivo) throw new Error('Este sistema não tem yt-dlp pronto para baixar. Instale pelo gerenciador de pacotes.');
  andamento({ etapa: 'Procurando a versão mais nova do yt-dlp', componente: 'ytdlp', baixado: 0, total: 0 });
  const v = await ultimaVersao(fonte.repo, fonte.arquivo);
  const temp = path.join(config.pastas.temp, `yt-dlp-${Date.now()}${EXE}`);
  try {
    const sha = await baixarArquivo(v.url, temp, (baixado, total) => andamento({
      etapa: 'Baixando o yt-dlp', componente: 'ytdlp', baixado, total: total || v.tamanho,
    }));
    if (v.sha256 && sha !== v.sha256) throw new Error('O yt-dlp baixado não confere com o publicado (SHA-256). Tente de novo.');
    if (!so.EH_WINDOWS) await fsp.chmod(temp, 0o755);
    // No Windows dá para renomear um .exe em uso (mas não apagar): os
    // downloads em andamento terminam com a versão antiga.
    const antigo = `${ARQ_YTDLP}.antigo`;
    await apagar(antigo);
    if (existe(ARQ_YTDLP)) await fsp.rename(ARQ_YTDLP, antigo);
    await fsp.rename(temp, ARQ_YTDLP);
    await apagar(antigo);
    const m = memoria();
    gravarJson(config.ARQUIVO_COMPONENTES, { ...m, ultimaVerificacao: Date.now(), ultimaVersao: v.tag || m.ultimaVersao });
  } finally {
    await apagar(temp);
  }
}

async function instalarFfmpeg() {
  const fonte = FONTES.ffmpeg;
  if (!fonte.arquivo) throw new Error('Instale o FFmpeg pelo gerenciador de pacotes do sistema (ex.: sudo apt install ffmpeg).');
  andamento({ etapa: 'Procurando o FFmpeg', componente: 'ffmpeg', baixado: 0, total: 0 });
  const v = await ultimaVersao(fonte.repo, fonte.arquivo);
  const temp = path.join(config.pastas.temp, `ffmpeg-${Date.now()}.zip`);
  const novo = `${DIR_FFMPEG}.novo`;
  try {
    const sha = await baixarArquivo(v.url, temp, (baixado, total) => andamento({
      etapa: 'Baixando o FFmpeg', componente: 'ffmpeg', baixado, total: total || v.tamanho,
    }));
    if (v.sha256 && sha !== v.sha256) throw new Error('O FFmpeg baixado não confere com o publicado (SHA-256). Tente de novo.');
    andamento({ etapa: 'Descompactando o FFmpeg', componente: 'ffmpeg', baixado: 0, total: 0 });
    await apagar(novo);
    await extrairZip(temp, novo, (nome) => {
      const m = /\/bin\/([^/]+)$/.exec(nome);
      if (!m || /^ffplay/i.test(m[1])) return null; // o player não é usado
      return m[1];
    });
    if (!existe(path.join(novo, `ffmpeg${EXE}`)) || !existe(path.join(novo, `ffprobe${EXE}`))) {
      throw new Error('O pacote do FFmpeg veio diferente do esperado.');
    }
    await apagar(DIR_FFMPEG);
    await fsp.rename(novo, DIR_FFMPEG);
  } finally {
    await apagar(temp);
    await apagar(novo);
  }
}

/**
 * Instala o que falta. Com `atualizarYtdlp`, baixa o yt-dlp de novo mesmo que já exista.
 * Uma instalação por vez: quem chamar no meio recebe a mesma promessa.
 * @param {{atualizarYtdlp?: boolean}} [op]
 */
function instalar({ atualizarYtdlp = false } = {}) {
  if (instalacaoAtual) return instalacaoAtual;
  ultimoErro = '';
  instalacaoAtual = (async () => {
    try {
      const yt = localizarYtdlp();
      if (!yt || atualizarYtdlp) {
        if (yt && !yt.proprio && atualizarYtdlp) {
          throw new Error('O yt-dlp em uso foi instalado fora do SalvaTudo. Atualize por onde ele foi instalado.');
        }
        await instalarYtdlp();
      }
      if (!localizarFfmpeg()) await instalarFfmpeg();
    } catch (err) {
      ultimoErro = /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(String(err && (err.cause || err.message)))
        ? 'Sem conexão com a internet. Confira a rede e tente de novo.'
        : err.message;
      console.error('[componentes]', err);
      throw new Error(ultimoErro);
    } finally {
      instalando = null;
      instalacaoAtual = null;
      await avisar(true);
    }
  })();
  return instalacaoAtual;
}

/**
 * Procura uma versão nova do yt-dlp (no máximo uma vez a cada 20 horas, a não
 * ser que `forcar`). Instala se houver e o yt-dlp for o do próprio SalvaTudo.
 * @param {{forcar?: boolean}} [op]
 * @returns {Promise<{atualizado: boolean, versao: string | null}>}
 */
async function verificarAtualizacao({ forcar = false } = {}) {
  const yt = localizarYtdlp();
  if (!yt || !yt.proprio || !FONTES.ytdlp.arquivo) return { atualizado: false, versao: null };
  const m = memoria();
  if (!forcar && m.ultimaVerificacao && Date.now() - m.ultimaVerificacao < HORAS_ENTRE_VERIFICACOES * 3600e3) {
    return { atualizado: false, versao: await versaoYtdlp(yt.caminho) };
  }
  const v = await ultimaVersao(FONTES.ytdlp.repo, FONTES.ytdlp.arquivo);
  const atual = await versaoYtdlp(yt.caminho);
  gravarJson(config.ARQUIVO_COMPONENTES, { ...m, ultimaVerificacao: Date.now(), ultimaVersao: v.tag || m.ultimaVersao });
  if (!v.tag || !atual || v.tag <= atual) {
    await avisar(true);
    return { atualizado: false, versao: atual };
  }
  console.log(`[componentes] atualizando o yt-dlp de ${atual} para ${v.tag}`);
  await instalar({ atualizarYtdlp: true });
  return { atualizado: true, versao: v.tag };
}

/** Restos de uma instalação interrompida. */
async function faxina() {
  await apagar(`${ARQ_YTDLP}.antigo`);
  await apagar(`${DIR_FFMPEG}.novo`);
  for (const nome of await fsp.readdir(config.pastas.temp).catch(() => [])) {
    await apagar(path.join(config.pastas.temp, nome));
  }
}

module.exports = {
  estado,
  caminhos,
  instalar,
  verificarAtualizacao,
  faxina,
  aoMudar,
  extrairZip,
  emInstalacao: () => Boolean(instalacaoAtual),
};
