'use strict';

/**
 * Roda o yt-dlp: analisa links e baixa, contando o progresso linha a linha.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const config = require('../config');
const so = require('./so');
const componentes = require('./componentes');
const modelos = require('./modelos');
const analise = require('./analise');
const contas = require('./contas');
const tiktok = require('./tiktok');
const configuracao = require('../nucleo/configuracao');
const { ErroUsuario } = require('../nucleo/util');

/** Erro do yt-dlp já traduzido; `detalhe` guarda a mensagem original. */
class ErroDownload extends Error {
  /** @param {string} mensagem @param {string} [detalhe] @param {string | null} [conta] site que pede login */
  constructor(mensagem, detalhe = '', conta = null) {
    super(mensagem);
    this.status = 422;
    this.detalhe = detalhe;
    this.conta = conta;
  }
}

/** Ambiente comum a todas as execuções (FFmpeg, cache, motor de JavaScript). */
function ambiente() {
  const c = componentes.caminhos();
  if (!c) throw new ErroUsuario('O SalvaTudo ainda está preparando os componentes. Espere terminar.', 409);
  const cfg = configuracao.ler();
  return {
    exe: c.ytdlp,
    amb: {
      dirFfmpeg: c.dirFfmpeg,
      dirCache: config.pastas.cache,
      // no app, o próprio Electron roda o JavaScript do YouTube (ELECTRON_RUN_AS_NODE)
      motorJs: process.execPath,
      loginNavegador: contas.disponivel() ? '' : cfg.loginNavegador,
      limiteVelocidade: cfg.limiteVelocidade,
    },
  };
}

/**
 * Inicia o yt-dlp e entrega a saída linha por linha (UTF-8).
 * @param {string} exe
 * @param {string[]} args
 * @param {{aoLinha?: (linha: string) => void, juntarSaida?: boolean}} op
 */
function executar(exe, args, { aoLinha, juntarSaida = false } = {}) {
  const processo = spawn(exe, args, {
    windowsHide: true,
    // sem isso o Electron abriria outra janela em vez de rodar o JavaScript
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    detached: !so.EH_WINDOWS, // no Linux, para conseguir encerrar o grupo todo
  });
  const decSaida = new StringDecoder('utf8');
  const decErro = new StringDecoder('utf8');
  let resto = '';
  let saida = '';
  /** @type {string[]} */
  const erro = [];
  let restoErro = '';

  processo.stdout.on('data', (pedaco) => {
    const texto = decSaida.write(pedaco);
    if (juntarSaida) { saida += texto; return; }
    resto += texto;
    let i;
    while ((i = resto.indexOf('\n')) >= 0) {
      const linha = resto.slice(0, i).replace(/\r$/, '');
      resto = resto.slice(i + 1);
      if (linha && aoLinha) aoLinha(linha);
    }
  });
  processo.stderr.on('data', (pedaco) => {
    restoErro += decErro.write(pedaco);
    const linhas = restoErro.split(/\r?\n/);
    restoErro = linhas.pop() || '';
    for (const l of linhas) if (l.trim()) erro.push(l);
    if (erro.length > 200) erro.splice(0, erro.length - 200);
  });

  /** @type {Promise<{codigo: number | null, saida: string, erro: string}>} */
  const fim = new Promise((resolve, reject) => {
    processo.on('error', reject);
    processo.on('close', (codigo) => {
      if (restoErro.trim()) erro.push(restoErro);
      if (resto.trim() && aoLinha) aoLinha(resto.trim());
      resolve({ codigo, saida: saida + decSaida.end(), erro: erro.join('\n') });
    });
  });
  return { processo, fim };
}

/* ---------------- análise ---------------- */

const SEM_DOWNLOAD = [
  [/(^|\.)(open\.)?spotify\.com$/i, 'O Spotify protege as músicas contra cópia (DRM), então não dá para baixar de lá.'],
  [/(^|\.)deezer\.com$/i, 'O Deezer protege as músicas contra cópia (DRM), então não dá para baixar de lá.'],
  [/(^|\.)(netflix|primevideo|disneyplus|max|hbomax|globoplay\.globo|music\.apple|tidal|starplus|paramountplus)\.com$/i,
    'Esse serviço protege os vídeos contra cópia (DRM), então não dá para baixar.'],
];

/** @type {Map<string, {quando: number, dados: any}>} */
const cacheAnalise = new Map();

/** Arquivo de cookies das contas conectadas (ou null). Quem chama apaga depois. */
async function cookiesDasContas() {
  try { return await contas.exportar(); } catch (_) { return null; }
}

/** Cookies do TikTok em "a=1; b=2", para a leitura direta da página. */
async function cookiesTikTok(arquivo) {
  if (!arquivo) return '';
  const texto = await fsp.readFile(arquivo, 'utf8').catch(() => '');
  return texto.split('\n')
    .map((l) => l.replace(/^#HttpOnly_/, '').split('\t'))
    .filter((p) => p.length === 7 && /tiktok\.com$/i.test(p[0]))
    .map((p) => `${p[5]}=${p[6]}`)
    .join('; ');
}

/**
 * Lê o que tem no link: um vídeo, uma playlist ou um post de fotos.
 * @param {string} url
 * @param {{playlist?: boolean}} [op]
 */
async function analisar(url, { playlist = false } = {}) {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) { throw new ErroUsuario('Isso não parece um link. Copie o endereço completo (começando com https://).'); }
  for (const [teste, mensagem] of SEM_DOWNLOAD) if (/** @type {RegExp} */ (teste).test(host)) throw new ErroUsuario(/** @type {string} */ (mensagem));

  const chaveCache = `${playlist ? 'L' : 'V'}|${url}`;
  const guardado = cacheAnalise.get(chaveCache);
  if (guardado && Date.now() - guardado.quando < 10 * 60 * 1000) return guardado.dados;

  const { exe, amb } = ambiente();
  const cookies = await cookiesDasContas();
  try {
    // TikTok: posts de fotos o yt-dlp não baixa; o SalvaTudo lê direto
    if (tiktok.ehTikTok(url) && !/\/@[^/]+\/?$|\/(tag|music|collection)\//.test(url)) {
      try {
        const post = await tiktok.lerPost(url, { cookies: await cookiesTikTok(cookies) });
        if (tiktok.temFotos(post.item)) {
          const dados = tiktok.resumirFotos(url, post.id, post.autor, post.item);
          cacheAnalise.set(chaveCache, { quando: Date.now(), dados });
          return dados;
        }
        // vídeo: segue pelo yt-dlp, já com o link normal (links /photo/ e curtos ele não entende)
        url = `https://www.tiktok.com/@${post.autor}/video/${post.id}`;
      } catch (err) {
        console.warn('[tiktok] leitura direta falhou, tentando pelo yt-dlp:', err.message);
      }
    }

    const args = modelos.argsAnalise(url, amb, { playlist });
    if (cookies) args.splice(args.indexOf('--'), 0, '--cookies', cookies);
    const { processo, fim } = executar(exe, args, { juntarSaida: true });
    const limite = setTimeout(() => so.encerrarArvore(processo.pid), 3 * 60 * 1000);
    const r = await fim.finally(() => clearTimeout(limite));
    let info = null;
    try { info = JSON.parse(r.saida); } catch (_) { /* erro abaixo */ }
    if (r.codigo !== 0 || !info) {
      const t = modelos.traduzirErro(r.erro);
      const extrator = (/^ERROR: \[([^\]]+)\]/m.exec(r.erro) || [])[1];
      throw new ErroDownload(t.mensagem, t.detalhe, /logad|login|idade/i.test(t.mensagem) ? contas.sitePorExtrator(extrator) : null);
    }
    // link que só aponta para outro (redirecionamento): segue uma vez
    if (info._type === 'url' && info.url && info.url !== url) return analisar(info.url, { playlist });
    const dados = analise.resumir(info);
    cacheAnalise.set(chaveCache, { quando: Date.now(), dados });
    if (cacheAnalise.size > 60) cacheAnalise.delete(cacheAnalise.keys().next().value);
    return dados;
  } finally {
    contas.apagarExportado(cookies);
  }
}

/* ---------------- download ---------------- */

/**
 * Arquivos temporários deixados por um download interrompido no meio.
 * @param {string} arquivo  nome que o yt-dlp estava gravando
 * @param {number} desde    só apaga o que foi criado depois disso
 */
async function apagarParciais(arquivo, desde) {
  const pasta = path.dirname(arquivo);
  const nome = path.basename(arquivo);
  // "Titulo.f137.mp4" -> "Titulo"; "Titulo.mp4" -> "Titulo"
  const base = nome.replace(/\.f[\w-]+\.\w+$/, '').replace(/\.\w+$/, '');
  let itens = [];
  try { itens = await fsp.readdir(pasta); } catch (_) { return; }
  for (const item of itens) {
    const completo = path.join(pasta, item);
    const ehParte = item === `${nome}.part` || item === `${nome}.ytdl` || item.startsWith(`${nome}.part-Frag`)
      || (item.startsWith(`${base}.`) && /\.(part|ytdl|temp\.\w+)$|\.part-Frag\d+/.test(item));
    const ehIntermediario = item.startsWith(`${base}.`) && /^\.f[\w-]+\.\w+$/.test(item.slice(base.length));
    const ehAcessorio = item.startsWith(`${base}.`) && /^\.(webp|jpg|jpeg|png|vtt|srt|ass|[\w-]+\.(vtt|srt|ass))$/i.test(item.slice(base.length));
    if (!ehParte && !ehIntermediario && !ehAcessorio) continue;
    try {
      const st = await fsp.stat(completo);
      if (st.mtimeMs >= desde - 2000) await fsp.rm(completo, { force: true });
    } catch (_) { /* já foi */ }
  }
  // pasta do canal criada só para este download e agora vazia
  await fsp.rmdir(pasta).catch(() => {});
}

/**
 * @typedef {object} Ganchos
 * @property {(info: any) => void} [aoInfo]           título, capa, canal...
 * @property {(p: any) => void} [aoProgresso]          porcentagem, velocidade, etapa
 */

/**
 * Baixa um item. Devolve o controle para pausar/cancelar e a promessa do resultado.
 * @param {{url: string, pedido: modelos.Pedido}} item
 * @param {Ganchos} ganchos
 */
function baixar(item, { aoInfo, aoProgresso } = {}) {
  const inicio = Date.now();
  let parado = '';
  /** @type {import('child_process').ChildProcess | null} */
  let processo = null;
  const controle = new AbortController();
  /** @type {Set<string>} */
  const emAndamento = new Set();

  const promessa = (async () => {
    const cookies = await cookiesDasContas();
    try {
      if (item.pedido.tipo === 'fotos') {
        return await tiktok.baixarFotos(item.url, {
          pasta: item.pedido.pasta,
          musica: item.pedido.musica !== false,
          lives: item.pedido.lives !== false,
          cookies: await cookiesTikTok(cookies),
        }, {
          aoInfo,
          aoProgresso: (p) => aoProgresso && aoProgresso({ ...p, velocidade: null, eta: null, estado: 'baixando' }),
          sinal: controle.signal,
        });
      }

      const { exe, amb } = ambiente();
      await fsp.mkdir(item.pedido.pasta, { recursive: true });
      const args = modelos.argsDownload(item.url, item.pedido, amb);
      if (cookies) args.splice(args.indexOf('--'), 0, '--cookies', cookies);

      const andamento = new modelos.Andamento();
      let arquivoFinal = null;
      let etapa = 'Conectando';
      let estado = 'baixando';
      let ultimoAviso = 0;
      const avisar = (forcar = false) => {
        const agora = Date.now();
        if (!aoProgresso || (!forcar && agora - ultimoAviso < 250)) return;
        ultimoAviso = agora;
        aoProgresso({ ...andamento.resumo(), etapa, estado });
      };

      const exec = executar(exe, args, {
        aoLinha: (linha) => {
          const ev = modelos.lerLinha(linha);
          if (!ev) return;
          if (ev.tipo === 'info') {
            if (aoInfo) aoInfo(ev.info);
          } else if (ev.tipo === 'formatos') {
            andamento.definirFormatos(ev.formatos);
          } else if (ev.tipo === 'progresso') {
            if (ev.arquivo) emAndamento.add(ev.arquivo);
            andamento.registrar(ev);
            const r = andamento.resumo();
            etapa = r.parte ? (r.parte.atual === 1 ? 'Baixando o vídeo' : 'Baixando o áudio') : 'Baixando';
            if (item.pedido.tipo === 'audio') etapa = 'Baixando o áudio';
            estado = 'baixando';
            avisar(ev.status === 'finished');
          } else if (ev.tipo === 'etapa') {
            const nome = modelos.nomeEtapa(ev.processador, item.pedido);
            if (nome && ev.status === 'started') {
              etapa = nome;
              estado = 'finalizando';
              avisar(true);
            }
          } else if (ev.tipo === 'fim') {
            arquivoFinal = ev.arquivo;
          }
        },
      });
      processo = exec.processo;
      const r = await exec.fim;
      if (parado) throw new Error(parado);
      if (r.codigo !== 0) {
        const t = modelos.traduzirErro(r.erro);
        const extrator = (/^ERROR: \[([^\]]+)\]/m.exec(r.erro) || [])[1];
        throw new ErroDownload(t.mensagem, t.detalhe, /logad|login|idade/i.test(t.mensagem) ? contas.sitePorExtrator(extrator) : null);
      }
      if (!arquivoFinal || !fs.existsSync(arquivoFinal)) {
        throw new ErroDownload('O download terminou, mas o arquivo não apareceu na pasta.', r.erro.split('\n').slice(-3).join(' '));
      }
      const st = await fsp.stat(arquivoFinal);
      return { arquivo: arquivoFinal, arquivos: [arquivoFinal], tamanho: st.size, jaExistia: st.mtimeMs < inicio - 5000 };
    } finally {
      contas.apagarExportado(cookies);
    }
  })();

  return {
    promessa,
    /**
     * Para o download. Na pausa os pedaços ficam para continuar depois;
     * no cancelamento eles são apagados.
     * @param {'pausa' | 'cancelado'} motivo
     */
    async parar(motivo) {
      parado = motivo;
      controle.abort();
      if (processo && processo.exitCode == null) so.encerrarArvore(processo.pid);
      await promessa.catch(() => {});
      if (motivo === 'cancelado') {
        for (const arquivo of emAndamento) await apagarParciais(arquivo, inicio);
      }
    },
    /** Encerra na hora, sem esperar (o app está fechando). */
    encerrarJa() {
      parado = 'pausa';
      controle.abort();
      if (processo && processo.exitCode == null) so.encerrarArvore(processo.pid);
    },
  };
}

module.exports = { analisar, baixar, ErroDownload, executar, apagarParciais };
