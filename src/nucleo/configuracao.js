'use strict';

/**
 * Preferências guardadas no disco (dados/config.json).
 */

const path = require('path');
const config = require('../config');
const { lerJson, gravarJson } = require('./util');

const BASE = path.join(config.pastaDownloadsPadrao(), 'SalvaTudo');

const OPCOES = {
  organizarVideos: ['canal', 'site', 'data', 'nenhuma'],
  organizarMusicas: ['artista-album', 'artista', 'nenhuma'],
  tipoPadrao: ['video', 'audio'],
  qualidadePadrao: ['max', '2160', '1440', '1080', '720', '480', '360'],
  formatoVideo: ['mp4', 'mkv'],
  formatoAudio: ['original', 'm4a', 'mp3', 'flac'],
  loginNavegador: ['', 'firefox', 'chrome', 'edge', 'brave', 'opera', 'vivaldi'],
};

/**
 * @typedef {object} Preferencias
 * @property {string} pastaVideos
 * @property {string} pastaMusicas
 * @property {string} pastaFotos
 * @property {string} organizarVideos
 * @property {string} organizarMusicas
 * @property {boolean} numerarPlaylist
 * @property {string} tipoPadrao
 * @property {string} qualidadePadrao
 * @property {string} formatoVideo
 * @property {string} formatoAudio
 * @property {boolean} legendas
 * @property {boolean} capaQuadrada
 * @property {boolean} fotosMusica     baixar a música junto das fotos do TikTok
 * @property {boolean} fotosLive       baixar o vídeo das Live Photos
 * @property {number} simultaneos
 * @property {number} limiteVelocidade  MB/s (0 = sem limite)
 * @property {string} loginNavegador
 * @property {boolean} notificar
 * @property {boolean} abrirPastaAoTerminar
 * @property {boolean} vigiarAreaTransferencia
 * @property {boolean} atualizarAuto
 */

/** @type {Preferencias} */
const PADRAO = {
  pastaVideos: path.join(BASE, 'Vídeos'),
  pastaMusicas: path.join(BASE, 'Músicas'),
  pastaFotos: path.join(BASE, 'Fotos'),
  organizarVideos: 'canal',
  organizarMusicas: 'artista-album',
  numerarPlaylist: true,
  tipoPadrao: 'video',
  qualidadePadrao: '1080', // leve e abre em tudo; 4K fica a um clique
  formatoVideo: 'mp4',
  formatoAudio: 'original',
  legendas: false,
  capaQuadrada: true,
  fotosMusica: true,
  fotosLive: true,
  simultaneos: 2,
  limiteVelocidade: 0,
  loginNavegador: '',
  notificar: true,
  abrirPastaAoTerminar: false,
  vigiarAreaTransferencia: true,
  atualizarAuto: true,
};

/** @type {Preferencias | null} */
let atual = null;
const ouvintes = new Set();

/** @returns {Preferencias} */
function ler() {
  if (!atual) atual = { ...PADRAO, ...lerJson(config.ARQUIVO_CONFIG, {}) };
  return atual;
}

/**
 * Aceita só valores válidos; o resto é ignorado.
 * @param {Partial<Preferencias>} parcial
 */
function salvar(parcial) {
  const novo = { ...ler() };
  for (const chave of ['pastaVideos', 'pastaMusicas', 'pastaFotos']) {
    const v = parcial[chave];
    if (typeof v === 'string' && v.trim() && path.isAbsolute(v.trim())) novo[chave] = path.normalize(v.trim());
  }
  for (const [chave, validos] of Object.entries(OPCOES)) {
    if (validos.includes(parcial[chave])) novo[chave] = parcial[chave];
  }
  for (const chave of ['numerarPlaylist', 'legendas', 'capaQuadrada', 'fotosMusica', 'fotosLive', 'notificar', 'abrirPastaAoTerminar', 'vigiarAreaTransferencia', 'atualizarAuto']) {
    if (typeof parcial[chave] === 'boolean') novo[chave] = parcial[chave];
  }
  if (Number.isInteger(parcial.simultaneos) && parcial.simultaneos >= 1 && parcial.simultaneos <= 5) novo.simultaneos = parcial.simultaneos;
  if (typeof parcial.limiteVelocidade === 'number' && parcial.limiteVelocidade >= 0 && parcial.limiteVelocidade <= 1000) {
    novo.limiteVelocidade = Math.round(parcial.limiteVelocidade * 10) / 10;
  }
  atual = novo;
  gravarJson(config.ARQUIVO_CONFIG, novo);
  for (const fn of ouvintes) fn(novo);
  return novo;
}

/** @param {(p: Preferencias) => void} fn */
function aoMudar(fn) {
  ouvintes.add(fn);
}

module.exports = { ler, salvar, aoMudar, PADRAO, OPCOES };
