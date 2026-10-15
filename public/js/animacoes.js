import { useEffect, useLayoutEffect, useRef, useState } from './lib.js';

/* ============================================================
   Animações: tudo com a Web Animations API (sem bibliotecas),
   respeitando quem pede menos movimento no Windows.
   ============================================================ */

export const poucoMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const CORES = ['#6246ea', '#a34cf5', '#22c55e', '#f5b100', '#ff4f8b', '#17a9d6'];

/**
 * Confete discreto saindo de um ponto da tela.
 * @param {number} x
 * @param {number} y
 * @param {{quantidade?: number, forca?: number}} [op]
 */
export function confete(x, y, { quantidade = 26, forca = 1 } = {}) {
  if (poucoMovimento()) return;
  const camada = document.createElement('div');
  camada.className = 'camada-confete';
  document.body.appendChild(camada);
  const fim = [];
  for (let i = 0; i < quantidade; i += 1) {
    const p = document.createElement('i');
    const tam = 5 + Math.random() * 5;
    p.style.cssText = `left:${x}px;top:${y}px;width:${tam}px;height:${tam * (Math.random() > 0.5 ? 0.45 : 1)}px;`
      + `background:${CORES[i % CORES.length]};border-radius:${Math.random() > 0.6 ? '50%' : '2px'}`;
    camada.appendChild(p);
    const angulo = (-Math.PI / 2) + (Math.random() - 0.5) * Math.PI * 1.1;
    const distancia = (70 + Math.random() * 110) * forca;
    const dx = Math.cos(angulo) * distancia;
    const dy = Math.sin(angulo) * distancia;
    const giro = (Math.random() - 0.5) * 720;
    const a = p.animate([
      { transform: 'translate(-50%, -50%) scale(0.6) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${giro / 2}deg)`, opacity: 1, offset: 0.55 },
      { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 90}px)) scale(0.9) rotate(${giro}deg)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' });
    fim.push(a.finished);
  }
  Promise.all(fim).finally(() => camada.remove());
}

/** Confete saindo do centro de um elemento. */
export function confeteEm(el, op) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  confete(r.left + r.width / 2, r.top + r.height / 2, op);
}

/**
 * A capa do vídeo "voa" até a lista de downloads.
 * @param {Element | null} origem
 */
export async function voarParaFila(origem) {
  const destino = document.getElementById('fila');
  if (!origem || !destino || poucoMovimento()) return;
  const r = origem.getBoundingClientRect();
  const alvo = destino.getBoundingClientRect();
  const clone = /** @type {HTMLElement} */ (origem.cloneNode(true));
  clone.classList.add('voando');
  clone.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;z-index:950;pointer-events:none`;
  document.body.appendChild(clone);
  const dx = alvo.left + 70 - (r.left + r.width / 2);
  const dy = Math.min(window.innerHeight - 40, Math.max(alvo.top + 60, 80)) - (r.top + r.height / 2);
  const anim = clone.animate([
    { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1, borderRadius: '14px' },
    { transform: `translate(${dx * 0.45}px, ${dy * 0.25 - 60}px) scale(0.62) rotate(-4deg)`, opacity: 1, offset: 0.45 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.16) rotate(4deg)`, opacity: 0.15, borderRadius: '30px' },
  ], { duration: 720, easing: 'cubic-bezier(0.45, 0, 0.2, 1)', fill: 'forwards' });
  await anim.finished.catch(() => {});
  clone.remove();
}

/** Recolhe um elemento (altura e opacidade até zero) antes de ele sumir. */
export async function recolher(el, duracao = 320) {
  if (!el || poucoMovimento()) return;
  const altura = el.getBoundingClientRect().height;
  el.style.overflow = 'hidden';
  const anim = el.animate([
    { height: `${altura}px`, opacity: 1, transform: 'scale(1)' },
    { height: '0px', opacity: 0, transform: 'scale(0.98)', marginTop: '0px', paddingTop: '0px', paddingBottom: '0px' },
  ], { duration: duracao, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
  await anim.finished.catch(() => {});
}

/**
 * Lista que se reorganiza deslizando (técnica FLIP): quando um item muda de
 * lugar, ele anda até a nova posição em vez de pular.
 * @param {{current: HTMLElement | null}} ref  o contêiner; os filhos precisam de data-chave
 * @param {any} dependencia  muda quando a ordem pode ter mudado
 */
export function useListaFluida(ref, dependencia) {
  const posicoes = useRef(new Map());
  useLayoutEffect(() => {
    const caixa = ref.current;
    if (!caixa) return;
    const novas = new Map();
    for (const filho of /** @type {HTMLElement[]} */ ([...caixa.children])) {
      const chave = filho.dataset.chave;
      if (!chave) continue;
      const r = filho.getBoundingClientRect();
      novas.set(chave, r.top);
      const antes = posicoes.current.get(chave);
      if (antes != null && Math.abs(antes - r.top) > 2 && !poucoMovimento()) {
        filho.animate([
          { transform: `translateY(${antes - r.top}px)` },
          { transform: 'translateY(0)' },
        ], { duration: 380, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      }
    }
    posicoes.current = novas;
  }, [dependencia]);
}

/**
 * Número que corre suave até o valor novo (a porcentagem não "pula" de 12 para 31).
 * @param {number} alvo
 */
export function useNumeroSuave(alvo) {
  const [valor, setValor] = useState(alvo);
  const atual = useRef(alvo);
  useEffect(() => {
    if (poucoMovimento()) { atual.current = alvo; setValor(alvo); return undefined; }
    let quadro = 0;
    const passo = () => {
      const dif = alvo - atual.current;
      if (Math.abs(dif) < 0.15) { atual.current = alvo; setValor(alvo); return; }
      atual.current += dif * 0.14;
      setValor(atual.current);
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [alvo]);
  return valor;
}

/** Valor anterior de uma prop (para perceber "acabou de terminar"). */
export function useAnterior(valor) {
  const ref = useRef(valor);
  useEffect(() => { ref.current = valor; });
  return ref.current;
}
