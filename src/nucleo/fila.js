'use strict';

/**
 * A fila de downloads. Cada link vira um item; alguns baixam ao mesmo tempo
 * (Configurações > downloads simultâneos) e o resto espera a vez.
 *
 * A fila fica gravada em dados/fila.json: se o app fechar no meio, ao abrir
 * de novo os downloads continuam de onde pararam (o yt-dlp retoma os pedaços).
 */

const path = require('path');
const config = require('../config');
const eventos = require('./eventos');
const configuracao = require('./configuracao');
const historico = require('./historico');
const ytdlp = require('../motores/ytdlp');
const componentes = require('../motores/componentes');
const analise = require('../motores/analise');
const so = require('../motores/so');
const { lerJson, gravarJsonSemFalhar, adiar, gerarId } = require('./util');

/**
 * @typedef {object} Item
 * @property {string} id
 * @property {number} ordem
 * @property {string} url
 * @property {string | null} chave
 * @property {string} titulo
 * @property {string | null} miniatura
 * @property {string | null} canal
 * @property {string | null} site
 * @property {number | null} duracao
 * @property {{id: string, titulo: string} | null} grupo   playlist de onde veio
 * @property {import('../motores/modelos').Pedido} pedido
 * @property {'aguardando' | 'baixando' | 'finalizando' | 'pausado' | 'concluido' | 'erro' | 'cancelado'} estado
 * @property {any} progresso
 * @property {string | null} arquivo
 * @property {number | null} tamanho
 * @property {string | null} formato
 * @property {boolean} jaExistia
 * @property {string | null} erro
 * @property {string | null} detalhe
 * @property {string | null} conta     site que precisa de login para este item
 * @property {number} criadoEm
 * @property {number | null} concluidoEm
 * @property {number} tentativas
 */

const EM_CURSO = ['baixando', 'finalizando'];
const FINAIS = ['concluido', 'erro', 'cancelado'];

/** @type {Map<string, Item>} */
const itens = new Map();
/** @type {Map<string, {parar: (m: 'pausa' | 'cancelado') => Promise<void>, encerrarJa: () => void}>} */
const ativos = new Map();
let contador = 0;
/** Resolução e fotos descobertas no download (só para montar o rótulo do formato). */
/** @type {Map<string, any>} */
const infos = new Map();

const gravar = adiar(() => gravarJsonSemFalhar(config.ARQUIVO_FILA, [...itens.values()]), 700);

/* ---------------- avisos ---------------- */

/** @type {Set<(r: ReturnType<typeof resumo>) => void>} */
const ouvintesResumo = new Set();
let lote = { concluidos: /** @type {Item[]} */ ([]), erros: 0 };
let estavaOcupado = false;

function resumo() {
  const lista = [...itens.values()];
  const emCurso = lista.filter((i) => EM_CURSO.includes(i.estado));
  const aguardando = lista.filter((i) => i.estado === 'aguardando').length;
  const pcts = emCurso.map((i) => (i.progresso && i.progresso.pct) || 0);
  return {
    emCurso: emCurso.length,
    aguardando,
    pausados: lista.filter((i) => i.estado === 'pausado').length,
    ocupado: emCurso.length + aguardando > 0,
    pct: pcts.length ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null,
  };
}

let ultimoResumo = 0;
function avisarResumo(forcar = false) {
  const agora = Date.now();
  if (!forcar && agora - ultimoResumo < 500) return;
  ultimoResumo = agora;
  const r = resumo();
  for (const fn of ouvintesResumo) fn(r);
  if (estavaOcupado && !r.ocupado) terminouTudo();
  estavaOcupado = r.ocupado;
}

/** A fila esvaziou: um aviso só para o lote inteiro, não um por arquivo. */
function terminouTudo() {
  const { concluidos, erros } = lote;
  lote = { concluidos: [], erros: 0 };
  if (!concluidos.length && !erros) return;
  const cfg = configuracao.ler();
  const ultimo = concluidos[concluidos.length - 1];
  if (cfg.notificar) {
    const titulo = concluidos.length === 1 && !erros ? 'Download concluído'
      : concluidos.length ? `${concluidos.length} downloads concluídos` : 'Downloads com erro';
    const corpo = concluidos.length === 1 ? ultimo.titulo
      : erros ? `${erros} não ${erros === 1 ? 'deu' : 'deram'} certo. Abra o SalvaTudo para ver.` : 'Tudo salvo nas pastas.';
    so.notificar(titulo, corpo, () => { if (ultimo && ultimo.arquivo) so.mostrarNaPasta(ultimo.arquivo); });
  }
  if (cfg.abrirPastaAoTerminar && ultimo && ultimo.arquivo) so.mostrarNaPasta(ultimo.arquivo);
}

/** @param {Item} item */
function publicar(item, { salvar = true } = {}) {
  eventos.publicar('item', item);
  if (salvar) gravar();
  avisarResumo(salvar);
}

/* ---------------- carregar ---------------- */

function carregar() {
  const salvos = lerJson(config.ARQUIVO_FILA, []);
  for (const it of Array.isArray(salvos) ? salvos : []) {
    if (!it || !it.id || !it.pedido) continue;
    // estava baixando quando o app fechou: volta para a fila e continua
    if (EM_CURSO.includes(it.estado)) it.estado = 'aguardando';
    if (it.estado === 'aguardando') it.progresso = it.progresso && it.progresso.pct ? { ...it.progresso, velocidade: null, eta: null, etapa: 'Na fila' } : null;
    contador = Math.max(contador, it.ordem || 0);
    itens.set(it.id, it);
  }
}

/* ---------------- andamento ---------------- */

function rotuloFormato(item, info) {
  const p = item.pedido;
  if (p.tipo === 'fotos') {
    const n = info && info.fotos ? info.fotos.length : null;
    return n ? `${n} ${n === 1 ? 'foto' : 'fotos'}` : 'Fotos';
  }
  const ext = item.arquivo ? path.extname(item.arquivo).slice(1).toUpperCase() : '';
  if (p.tipo === 'audio') return ext || p.formatoAudio.toUpperCase();
  const altura = info && info.width && info.height ? Math.min(info.width, info.height) : info && info.height;
  return [ext || p.formatoVideo.toUpperCase(), altura ? analise.rotuloQualidade(altura) : null].filter(Boolean).join(' · ');
}

/** Completa o item com o que o download descobriu (título, capa, canal...). */
function preencher(item, info) {
  if (!info) return;
  const titulo = info.title || info.titulo;
  if (titulo && (!item.titulo || item.titulo === item.url || /^Item \d+$/.test(item.titulo))) item.titulo = titulo;
  item.miniatura = item.miniatura || info.thumbnail || info.miniatura || null;
  item.canal = item.canal || info.artist || info.channel || info.uploader || info.canal || null;
  item.duracao = item.duracao || info.duration || null;
  item.site = item.site || info.extractor_key || info.site || null;
  if (!item.chave) item.chave = info.chave || analise.chave(info.extractor_key, info.id);
  infos.set(item.id, { width: info.width, height: info.height, fotos: info.fotos });
}

/** @param {Item} item */
function iniciar(item) {
  item.estado = 'baixando';
  item.erro = null;
  item.detalhe = null;
  item.conta = null;
  item.progresso = { pct: (item.progresso && item.progresso.pct) || 0, etapa: 'Conectando', velocidade: null, eta: null };
  publicar(item);

  const controle = ytdlp.baixar(item, {
    aoInfo: (info) => { preencher(item, info); publicar(item); },
    aoProgresso: (p) => {
      if (!EM_CURSO.includes(item.estado)) return; // pausado/cancelado no meio
      item.estado = p.estado === 'finalizando' ? 'finalizando' : 'baixando';
      item.progresso = { pct: p.pct, baixado: p.baixado, total: p.total, velocidade: p.velocidade, eta: p.eta, etapa: p.etapa, parte: p.parte || null };
      publicar(item, { salvar: false });
    },
  });
  ativos.set(item.id, controle);

  controle.promessa
    .then((r) => {
      if (!itens.has(item.id) || !EM_CURSO.includes(item.estado)) return;
      item.estado = 'concluido';
      item.arquivo = r.arquivo;
      item.tamanho = r.tamanho;
      item.jaExistia = Boolean(r.jaExistia);
      item.concluidoEm = Date.now();
      item.formato = rotuloFormato(item, infos.get(item.id));
      item.progresso = { pct: 100, etapa: 'Pronto' };
      historico.adicionar({
        id: item.id,
        chave: item.chave,
        url: item.url,
        titulo: item.titulo,
        canal: item.canal,
        site: item.site,
        miniatura: item.miniatura,
        duracao: item.duracao,
        tipo: item.pedido.tipo,
        formato: item.formato,
        arquivo: item.arquivo,
        tamanho: item.tamanho,
        concluidoEm: item.concluidoEm,
      });
      lote.concluidos.push(item);
      publicar(item);
    })
    .catch((err) => {
      if (!itens.has(item.id) || !EM_CURSO.includes(item.estado)) return; // pausa ou cancelamento
      item.estado = 'erro';
      item.tentativas = (item.tentativas || 0) + 1;
      const traduzido = err instanceof ytdlp.ErroDownload || (err && err.status);
      item.erro = traduzido ? err.message : 'Não foi possível baixar este item.';
      item.detalhe = (err && err.detalhe) || (traduzido ? null : String((err && err.message) || err));
      item.conta = (err && err.conta) || null;
      if (!traduzido) console.error('[fila]', err);
      lote.erros += 1;
      publicar(item);
    })
    .finally(() => {
      ativos.delete(item.id);
      infos.delete(item.id);
      bombear();
      avisarResumo(true);
    });
}

/** Começa os próximos da fila, até o limite de downloads ao mesmo tempo. */
function bombear() {
  if (!componentes.caminhos() || componentes.emInstalacao()) return;
  const livres = configuracao.ler().simultaneos - ativos.size;
  if (livres <= 0) return;
  [...itens.values()]
    .filter((i) => i.estado === 'aguardando')
    .sort((a, b) => a.ordem - b.ordem)
    .slice(0, livres)
    .forEach(iniciar);
}

/* ---------------- ações ---------------- */

/**
 * @param {Array<{url: string, titulo?: string, miniatura?: string, canal?: string, duracao?: number,
 *   site?: string, chave?: string, grupo?: {id: string, titulo: string} | null, pedido: Item['pedido']}>} novos
 */
function adicionar(novos) {
  const adicionados = [];
  let repetidos = 0;
  // o mesmo link em outro formato (MP3 e original, 720p e 1080p) não é repetido
  const assinatura = (url, p) => [url, p.tipo, p.pasta,
    p.tipo === 'audio' ? p.formatoAudio : p.tipo === 'video' ? `${p.formatoVideo}-${p.qualidade}` : ''].join('|');
  for (const n of novos) {
    const desta = assinatura(n.url, n.pedido);
    const repetido = [...itens.values()].some((i) => !FINAIS.includes(i.estado) && assinatura(i.url, i.pedido) === desta);
    if (repetido) { repetidos += 1; continue; }
    contador += 1;
    /** @type {Item} */
    const item = {
      id: gerarId(),
      ordem: contador,
      url: n.url,
      chave: n.chave || null,
      titulo: n.titulo || n.url,
      miniatura: n.miniatura || null,
      canal: n.canal || null,
      site: n.site || null,
      duracao: n.duracao || null,
      grupo: n.grupo || null,
      pedido: n.pedido,
      estado: 'aguardando',
      progresso: null,
      arquivo: null,
      tamanho: null,
      formato: null,
      jaExistia: false,
      erro: null,
      detalhe: null,
      conta: null,
      criadoEm: Date.now(),
      concluidoEm: null,
      tentativas: 0,
    };
    itens.set(item.id, item);
    adicionados.push(item);
    eventos.publicar('item', item);
  }
  gravar();
  avisarResumo(true);
  bombear();
  return { adicionados, repetidos };
}

const pegar = (id) => itens.get(id) || null;

async function pausar(id) {
  const item = pegar(id);
  if (!item || !['aguardando', ...EM_CURSO].includes(item.estado)) return item;
  const controle = ativos.get(id);
  item.estado = 'pausado';
  if (item.progresso) item.progresso = { ...item.progresso, velocidade: null, eta: null, etapa: 'Pausado' };
  publicar(item);
  if (controle) await controle.parar('pausa');
  return item;
}

function retomar(id) {
  const item = pegar(id);
  if (!item || !['pausado', 'erro', 'cancelado'].includes(item.estado)) return item;
  if (item.estado !== 'pausado') item.progresso = null;
  item.estado = 'aguardando';
  item.erro = null;
  item.detalhe = null;
  publicar(item);
  bombear();
  return item;
}

async function cancelar(id) {
  const item = pegar(id);
  if (!item || FINAIS.includes(item.estado)) return item;
  const controle = ativos.get(id);
  item.estado = 'cancelado';
  item.progresso = null;
  publicar(item);
  if (controle) await controle.parar('cancelado');
  return item;
}

async function remover(id) {
  const item = pegar(id);
  if (!item) return;
  if (!FINAIS.includes(item.estado) && item.estado !== 'pausado') await cancelar(id);
  itens.delete(id);
  eventos.publicar('item-removido', { id });
  gravar();
  avisarResumo(true);
}

/** Tira da lista o que já terminou (concluídos e cancelados). */
function limparFinalizados() {
  for (const item of [...itens.values()]) {
    if (item.estado === 'concluido' || item.estado === 'cancelado') {
      itens.delete(item.id);
      eventos.publicar('item-removido', { id: item.id });
    }
  }
  gravar();
}

async function pausarTudo() {
  for (const item of [...itens.values()]) {
    if (['aguardando', ...EM_CURSO].includes(item.estado)) await pausar(item.id);
  }
}

function retomarTudo() {
  for (const item of [...itens.values()]) if (item.estado === 'pausado') retomar(item.id);
}

function tentarErrosDeNovo() {
  for (const item of [...itens.values()]) if (item.estado === 'erro') retomar(item.id);
}

function listar() {
  return [...itens.values()].sort((a, b) => a.ordem - b.ordem);
}

/** O app está fechando: para tudo já (os pedaços ficam para continuar depois). */
function encerrar() {
  for (const controle of ativos.values()) controle.encerrarJa();
  gravar.agora();
}

/** @param {(r: ReturnType<typeof resumo>) => void} fn */
function aoResumo(fn) {
  ouvintesResumo.add(fn);
}

carregar();
configuracao.aoMudar(() => bombear());

module.exports = {
  adicionar,
  listar,
  pegar,
  pausar,
  retomar,
  cancelar,
  remover,
  limparFinalizados,
  pausarTudo,
  retomarTudo,
  tentarErrosDeNovo,
  bombear,
  resumo,
  aoResumo,
  encerrar,
};
