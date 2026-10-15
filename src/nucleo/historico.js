'use strict';

/**
 * Tudo o que já foi baixado (dados/historico.json), do mais novo para o mais
 * antigo. Serve para a tela de Histórico e para avisar "você já baixou isto".
 */

const fs = require('fs');
const config = require('../config');
const eventos = require('./eventos');
const { lerJson, gravarJsonSemFalhar, adiar } = require('./util');

/**
 * @typedef {object} Registro
 * @property {string} id
 * @property {string | null} chave
 * @property {string} url
 * @property {string} titulo
 * @property {string | null} canal
 * @property {string | null} site
 * @property {string | null} miniatura
 * @property {number | null} duracao
 * @property {'video' | 'audio' | 'fotos'} tipo
 * @property {string} formato     "MP4 · 1080p", "MP3", "5 fotos"...
 * @property {string} arquivo     arquivo (ou pasta, para fotos)
 * @property {number | null} tamanho
 * @property {number} concluidoEm
 */

/** @type {Registro[]} */
let lista = lerJson(config.ARQUIVO_HISTORICO, []);
if (!Array.isArray(lista)) lista = [];

const gravar = adiar(() => gravarJsonSemFalhar(config.ARQUIVO_HISTORICO, lista), 600);

function mudou() {
  gravar();
  eventos.publicar('historico', { total: lista.length });
}

/** @param {Registro} registro */
function adicionar(registro) {
  lista = [registro, ...lista.filter((r) => r.id !== registro.id)].slice(0, config.LIMITE_HISTORICO);
  mudou();
}

function existe(caminho) {
  try { return fs.existsSync(caminho); } catch (_) { return false; }
}

const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * @param {{busca?: string, tipo?: string, limite?: number}} [filtro]
 */
function listar({ busca = '', tipo = '', limite = 500 } = {}) {
  const termos = semAcento(busca).split(/\s+/).filter(Boolean);
  const achados = lista.filter((r) => {
    if (tipo && r.tipo !== tipo) return false;
    if (!termos.length) return true;
    const texto = semAcento(`${r.titulo} ${r.canal || ''} ${r.site || ''}`);
    return termos.every((t) => texto.includes(t));
  });
  return {
    total: lista.length,
    encontrados: achados.length,
    itens: achados.slice(0, limite).map((r) => ({ ...r, existe: existe(r.arquivo) })),
  };
}

function porId(id) {
  return lista.find((r) => r.id === id) || null;
}

/** Último download deste vídeo (pela chave "site:id"). */
function porChave(chave) {
  if (!chave) return null;
  const r = lista.find((x) => x.chave === chave && existe(x.arquivo));
  return r ? { id: r.id, quando: r.concluidoEm, tipo: r.tipo, formato: r.formato, arquivo: r.arquivo } : null;
}

/** Chaves já baixadas (para marcar os itens de uma playlist). */
function chavesBaixadas() {
  return new Set(lista.filter((r) => r.chave).map((r) => r.chave));
}

function remover(id) {
  const antes = lista.length;
  lista = lista.filter((r) => r.id !== id);
  if (lista.length !== antes) mudou();
}

function limpar() {
  lista = [];
  mudou();
}

module.exports = { adicionar, listar, porId, porChave, chavesBaixadas, remover, limpar, gravar };
