import { html, useEffect, useRef, useState, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { useLoja, fecharAviso, estado as estadoGlobal, api } from '../loja.js';
import { siteDe, nomeDoSite } from '../sites.js';
import { LOGOS } from '../logos.js';

/* ---------------- rotas (#/...) ---------------- */

export function lerRota() {
  const partes = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  return { tela: partes[0] || 'baixar', param: partes[1] ? decodeURIComponent(partes[1]) : null };
}

export function ir(caminho) {
  const alvo = `#/${caminho.replace(/^\/+/, '')}`;
  if (location.hash !== alvo) location.hash = alvo;
}

export function useRota() {
  const [rota, setRota] = useState(lerRota());
  useEffect(() => {
    const f = () => setRota(lerRota());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return rota;
}

/* ---------------- toasts ---------------- */

export function Toasts() {
  const { toasts } = useLoja();
  const icone = { ok: 'okCirculo', erro: 'erro', aviso: 'alerta', info: 'info' };
  return html`<div class="toasts" role="status" aria-live="polite">
    ${toasts.map((t) => html`<div class=${`toast ${t.tipo}`} key=${t.id}>
      <${Icone} nome=${icone[t.tipo] || 'info'} tam=${18} />
      <div class="texto">${t.titulo && html`<strong>${t.titulo}</strong>`}${t.texto}
        ${t.acao && html`<button class="toast-acao" onClick=${() => { t.acao.fazer(); fecharAviso(t.id); }}>${t.acao.rotulo}</button>`}
      </div>
      <button class="btn-icone p" onClick=${() => fecharAviso(t.id)} aria-label="Fechar aviso"><${Icone} nome="x" tam=${15} /></button>
    </div>`)}
  </div>`;
}

/* ---------------- diálogo ---------------- */

export function Dialogo({ titulo, aoFechar, children, rodape = null, classe = '', icone = null }) {
  useEffect(() => {
    const tecla = (e) => { if (e.key === 'Escape' && aoFechar) { e.stopPropagation(); aoFechar(); } };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, [aoFechar]);
  return html`<div class="capa" onMouseDown=${(e) => { if (e.target === e.currentTarget && aoFechar) aoFechar(); }}>
    <div class=${cx('dialogo', classe)} role="dialog" aria-modal="true" aria-label=${titulo}>
      <div class="dialogo-cab">
        ${icone}
        <h3>${titulo}</h3>
        ${aoFechar && html`<button class="btn-icone" onClick=${aoFechar} aria-label="Fechar"><${Icone} nome="x" /></button>`}
      </div>
      ${children}
      ${rodape && html`<div class="dialogo-rodape">${rodape}</div>`}
    </div>
  </div>`;
}

/** Pergunta de sim/não bonita (no lugar do confirm() do navegador). */
export function Confirmar({ titulo, texto, rotulo = 'Confirmar', perigo = false, aoConfirmar, aoFechar }) {
  return html`<${Dialogo} titulo=${titulo} aoFechar=${aoFechar}
    rodape=${html`<button class="btn btn-fantasma" onClick=${aoFechar}>Cancelar</button>
      <button class=${cx('btn', perigo ? 'btn-perigo-cheio' : 'btn-primario')} onClick=${() => { aoConfirmar(); aoFechar(); }}>${rotulo}</button>`}>
    <div class="dialogo-corpo"><p class="texto-dialogo">${texto}</p></div>
  <//>`;
}

/* ---------------- crédito ---------------- */

export const INSTAGRAM = 'https://www.instagram.com/ihagomartins1/';

/** "Desenvolvido por Ihago Martins" — leva ao Instagram. */
export function Credito({ classe = '' }) {
  const clicar = (e) => {
    const s = estadoGlobal.sistema;
    // dentro do app o link abre no navegador de sempre
    if (s && s.app) { e.preventDefault(); api.post('/abrir-link', { url: INSTAGRAM }).catch(() => window.open(INSTAGRAM, '_blank')); }
  };
  return html`<a class=${cx('credito', classe)} href=${INSTAGRAM} target="_blank" rel="noopener noreferrer"
      title="Abrir o Instagram @ihagomartins1" onClick=${clicar}>
    <span>Desenvolvido por <strong>Ihago Martins</strong></span>
  </a>`;
}

/* ---------------- pequenos componentes ---------------- */

export function Alerta({ nivel = 'info', children, classe = '' }) {
  const icone = { info: 'info', aviso: 'alerta', erro: 'erro', ok: 'okCirculo' };
  return html`<div class=${cx('alerta', nivel, classe)}><${Icone} nome=${icone[nivel]} tam=${17} /><div class="alerta-texto">${children}</div></div>`;
}

export function Anel({ tam = '' }) {
  return html`<span class=${cx('anel', tam)} aria-hidden="true"></span>`;
}

/** Botão liga/desliga com título e explicação. */
export function Alternar({ ligado, aoMudar, titulo, ajuda = null, desativado = false }) {
  return html`<button type="button" class=${cx('alternar', ligado && 'ligado')} role="switch" aria-checked=${ligado}
      disabled=${desativado} onClick=${() => aoMudar(!ligado)}>
    <span class="trilho"></span>
    <span class="texto"><strong>${titulo}</strong>${ajuda && html`<small>${ajuda}</small>`}</span>
  </button>`;
}

/** Escolha entre poucas opções, lado a lado. */
export function Segmentado({ opcoes, valor, aoMudar, rotulo = '' }) {
  return html`<div class="segmentado" role="radiogroup" aria-label=${rotulo}>
    ${opcoes.map((o) => html`<button type="button" key=${o.valor} role="radio" aria-checked=${valor === o.valor}
        class=${cx(valor === o.valor && 'ativo')} onClick=${() => aoMudar(o.valor)} disabled=${o.desativado}>
      ${o.icone && html`<${Icone} nome=${o.icone} tam=${16} />`}<span>${o.rotulo}</span>
    </button>`)}
  </div>`;
}

/** Logo da rede social (ou uma bolinha na cor do site, se não houver logo). */
export function Logo({ id, tam = 14, classe = '' }) {
  const l = id && LOGOS[id];
  if (!l) return html`<span class=${cx('ponto', classe)}></span>`;
  return html`<svg class=${cx('logo-site', classe)} width=${tam} height=${tam} viewBox="0 0 24 24"
    fill=${l.cor || 'currentColor'} aria-hidden="true"><path d=${l.d} /></svg>`;
}

/** Selo com o logo e o nome do site. */
export function SeloSite({ url = '', extrator = '', p = false }) {
  const site = siteDe(extrator || url) || siteDe(url);
  const nome = site ? site.nome : nomeDoSite(url || extrator);
  if (!nome) return null;
  return html`<span class=${cx('selo-site', p && 'p')} style=${`--cor-site:${site ? site.cor : 'var(--texto-3)'}`}>
    <${Logo} id=${site && site.id} tam=${p ? 11 : 13} />${nome}
  </span>`;
}

/** Capa do vídeo com fundo de reserva e duração por cima. */
export function Capa({ src, duracao = '', icone = 'video', classe = '', vertical = false, children = null }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [src]);
  return html`<div class=${cx('capa-midia', vertical && 'vertical', classe)}>
    ${src && !falhou
      ? html`<img src=${src} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${() => setFalhou(true)} />`
      : html`<span class="capa-reserva"><${Icone} nome=${icone} tam=${28} /></span>`}
    ${duracao && html`<span class="capa-duracao">${duracao}</span>`}
    ${children}
  </div>`;
}

/** Fecha ao clicar fora. */
export function useForaClique(ref, aoFechar, ativo = true) {
  useEffect(() => {
    if (!ativo) return undefined;
    const f = (e) => { if (ref.current && !ref.current.contains(e.target)) aoFechar(); };
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, [ativo, aoFechar]);
}

/** Atalho de teclado global. */
export function useAtalho(teste, acao, deps = []) {
  const ref = useRef(acao);
  ref.current = acao;
  useEffect(() => {
    const f = (e) => {
      if (teste(e)) { e.preventDefault(); ref.current(e); }
    };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, deps);
}

export function ehCampoDeTexto(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}
