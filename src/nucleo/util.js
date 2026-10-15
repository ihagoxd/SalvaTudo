'use strict';

const fs = require('fs');
const crypto = require('crypto');

/** Erro com mensagem pronta para mostrar na tela (status 400). */
class ErroUsuario extends Error {
  /** @param {string} mensagem @param {number} [status] */
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

function gerarId() {
  return crypto.randomBytes(8).toString('hex');
}

const RESERVADOS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Nome que o Windows aceita como pasta ou arquivo: tira \ / : * ? " < > |,
 * caracteres de controle e pontos/espaços do fim, e encurta nomes enormes.
 * @param {string} texto
 * @param {number} [max]
 */
function nomeSeguro(texto, max = 120) {
  let nome = String(texto || '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (nome.length > max) nome = nome.slice(0, max).trim();
  nome = nome.replace(/[. ]+$/, '');
  if (RESERVADOS.test(nome)) nome = `_${nome}`;
  return nome;
}

/** Texto fixo dentro de um modelo de nome do yt-dlp: % vira %%. */
function escaparModelo(texto) {
  return String(texto).replace(/%/g, '%%');
}

/** @template T @param {string} arquivo @param {T} padrao @returns {T} */
function lerJson(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch (_) {
    return padrao;
  }
}

/** Grava sem deixar o arquivo pela metade se o app fechar no meio. */
function gravarJson(arquivo, dados) {
  const temporario = `${arquivo}.${process.pid}.tmp`;
  fs.writeFileSync(temporario, JSON.stringify(dados, null, 2), 'utf8');
  fs.renameSync(temporario, arquivo);
}

/** Igual, mas uma falha (disco cheio, pasta apagada) só vai para o registro. */
function gravarJsonSemFalhar(arquivo, dados) {
  try {
    gravarJson(arquivo, dados);
  } catch (err) {
    console.error(`[gravar] ${arquivo}:`, err.message);
  }
}

/**
 * Junta várias chamadas seguidas numa só, depois de `ms` sem novas chamadas.
 * @param {() => void} fn
 * @param {number} ms
 */
function adiar(fn, ms) {
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  const chamar = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(); }, ms);
  };
  chamar.agora = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    fn();
  };
  return chamar;
}

/** Links http(s) dentro de um texto colado (um por linha, separados por espaço...). */
function extrairLinks(texto) {
  const achados = String(texto || '').match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const vistos = new Set();
  const links = [];
  for (const bruto of achados) {
    const link = bruto.replace(/[),.;!?]+$/, '');
    try {
      const u = new URL(link);
      if (!/^https?:$/.test(u.protocol) || vistos.has(u.href)) continue;
      vistos.add(u.href);
      links.push(u.href);
    } catch (_) { /* não é link */ }
  }
  return links;
}

module.exports = {
  ErroUsuario,
  gerarId,
  nomeSeguro,
  escaparModelo,
  lerJson,
  gravarJson,
  gravarJsonSemFalhar,
  adiar,
  extrairLinks,
};
