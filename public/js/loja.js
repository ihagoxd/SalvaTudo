import { useEffect, useReducer } from './lib.js';

/* ============================================================
   Estado global + conversa com o servidor
   ============================================================ */

export const estado = {
  sistema: null,          // versão, configuração, componentes, contas
  fila: {},               // id -> item da fila (atualizado em tempo real)
  toasts: [],
  conectado: false,
  historicoVersao: 0,     // muda quando entra algo no histórico
  pedidoLink: null,       // link enviado de outra tela ("baixar de novo")
};

const ouvintes = new Set();
let agendado = false;

/** Muda o estado e redesenha quem estiver ouvindo (uma vez por quadro). */
export function mudar(fn) {
  if (fn) fn(estado);
  if (agendado) return;
  agendado = true;
  requestAnimationFrame(() => {
    agendado = false;
    ouvintes.forEach((o) => o());
  });
}

export function useLoja() {
  const [, forcar] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    ouvintes.add(forcar);
    return () => { ouvintes.delete(forcar); };
  }, []);
  return estado;
}

/* ---------------- avisos (toasts) ---------------- */

let idToast = 0;

export function avisar(texto, tipo = 'info', { titulo = undefined, duracao = undefined, acao = undefined } = {}) {
  idToast += 1;
  const id = idToast;
  mudar((e) => { e.toasts = [...e.toasts.slice(-3), { id, texto, tipo, titulo, acao }]; });
  const ms = duracao != null ? duracao : tipo === 'erro' ? 8000 : 4200;
  if (ms > 0) setTimeout(() => fecharAviso(id), ms);
  return id;
}

export function fecharAviso(id) {
  mudar((e) => { e.toasts = e.toasts.filter((t) => t.id !== id); });
}

/* ---------------- HTTP ---------------- */

async function lerResposta(r) {
  let dados = {};
  try { dados = await r.json(); } catch (_) { /* resposta sem corpo */ }
  if (!r.ok || dados.ok === false) {
    const err = new Error(dados.erro || (r.status === 404 ? 'Não encontrado.' : 'O SalvaTudo não respondeu como esperado.'));
    Object.assign(err, { status: r.status, detalhe: dados.detalhe || null, conta: dados.conta || null });
    throw err;
  }
  return dados;
}

const JSON_CAB = { 'Content-Type': 'application/json' };

export const api = {
  async get(caminho) {
    return lerResposta(await fetch(`/api${caminho}`));
  },
  async post(caminho, corpo) {
    return lerResposta(await fetch(`/api${caminho}`, { method: 'POST', headers: JSON_CAB, body: JSON.stringify(corpo || {}) }));
  },
  async put(caminho, corpo) {
    return lerResposta(await fetch(`/api${caminho}`, { method: 'PUT', headers: JSON_CAB, body: JSON.stringify(corpo || {}) }));
  },
  async del(caminho) {
    return lerResposta(await fetch(`/api${caminho}`, { method: 'DELETE' }));
  },
};

/* ---------------- tempo real ---------------- */

let fonte = null;
let timerQueda = null;

async function carregarFila() {
  try {
    const d = await api.get('/fila');
    mudar((e) => {
      e.fila = {};
      for (const item of d.itens) e.fila[item.id] = item;
    });
  } catch (_) { /* tenta na próxima conexão */ }
}

export function conectarEventos() {
  if (fonte) return;
  fonte = new EventSource('/api/eventos');
  fonte.addEventListener('ola', () => {
    clearTimeout(timerQueda);
    mudar((e) => { e.conectado = true; });
    // reconectou: o que mudou enquanto estava fora vem de uma vez
    carregarFila();
  });
  fonte.addEventListener('item', (ev) => {
    const item = JSON.parse(ev.data);
    mudar((e) => {
      const antes = e.fila[item.id];
      e.fila[item.id] = item;
      if (item.estado === 'concluido' && antes && antes.estado !== 'concluido') e.historicoVersao += 1;
    });
  });
  fonte.addEventListener('item-removido', (ev) => {
    const { id } = JSON.parse(ev.data);
    mudar((e) => { delete e.fila[id]; });
  });
  fonte.addEventListener('componentes', (ev) => {
    const c = JSON.parse(ev.data);
    mudar((e) => { if (e.sistema) e.sistema = { ...e.sistema, componentes: c }; });
  });
  fonte.addEventListener('config', (ev) => {
    const d = JSON.parse(ev.data);
    mudar((e) => { if (e.sistema) e.sistema = { ...e.sistema, config: d.config, espaco: d.espaco }; });
  });
  fonte.addEventListener('contas', (ev) => {
    const c = JSON.parse(ev.data);
    mudar((e) => { if (e.sistema) e.sistema = { ...e.sistema, contas: c }; });
  });
  fonte.addEventListener('historico', () => {
    mudar((e) => { e.historicoVersao += 1; });
  });
  fonte.onerror = () => {
    // quedas rápidas (recarregar a página, reinício) não merecem aviso
    clearTimeout(timerQueda);
    timerQueda = setTimeout(() => mudar((e) => { e.conectado = false; }), 3500);
    if (fonte.readyState === EventSource.CLOSED) {
      fonte = null;
      setTimeout(conectarEventos, 2000);
    }
  };
}

export async function carregarSistema() {
  const d = await api.get('/sistema');
  mudar((e) => { e.sistema = d; });
  return d;
}

/** Salva uma parte da configuração e já atualiza a tela. */
export async function salvarConfig(parcial) {
  const d = await api.put('/config', parcial);
  mudar((e) => { if (e.sistema) e.sistema = { ...e.sistema, config: d.config, espaco: d.espaco }; });
  return d.config;
}

/** Janela do Windows para escolher pasta. null se a pessoa cancelar. */
export async function escolherPasta(inicial) {
  const d = await api.post('/escolher-pasta', { inicial });
  return d.pasta ? { pasta: d.pasta, espaco: d.espaco } : null;
}
