// Ponto único de importação do Preact + htm (JSX sem etapa de build).
export { html, render, h } from 'htm/preact';
export {
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, useReducer,
} from 'preact/hooks';

/** Junta classes condicionais: cx('a', cond && 'b') */
export function cx(...partes) {
  return partes.filter(Boolean).join(' ');
}

const nf = new Intl.NumberFormat('pt-BR');

export function numero(n) {
  return nf.format(n);
}

export function plural(n, um, varios) {
  return `${nf.format(n)} ${n === 1 ? um : varios}`;
}

/** 1536000 -> "1,5 MB" */
export function tamanho(bytes) {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1000 && i < u.length - 1) { v /= 1024; i += 1; }
  const casas = i <= 1 ? 0 : v < 10 ? 1 : 0;
  return `${v.toLocaleString('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas })} ${u[i]}`;
}

/** 3725 -> "1:02:05" ; 65 -> "1:05" */
export function duracao(segundos) {
  if (!segundos && segundos !== 0) return '';
  const s = Math.round(segundos);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const dois = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(r)}` : `${m}:${dois(r)}`;
}

/** 5400 -> "1 h 30 min" */
export function duracaoLonga(segundos) {
  if (!segundos) return '';
  const h = Math.floor(segundos / 3600);
  const m = Math.round((segundos % 3600) / 60);
  if (h && m) return `${h} h ${m} min`;
  if (h) return `${h} h`;
  return `${Math.max(1, m)} min`;
}

/** Bytes por segundo -> "3,2 MB/s" */
export function velocidade(bps) {
  if (!bps) return '';
  return `${tamanho(bps)}/s`;
}

/** Segundos que faltam -> "faltam 2 min" */
export function faltam(segundos) {
  if (segundos == null || !Number.isFinite(segundos)) return '';
  const s = Math.round(segundos);
  if (s < 5) return 'quase lá';
  if (s < 60) return `faltam ${s} s`;
  if (s < 3600) return `faltam ${Math.round(s / 60)} min`;
  return `faltam ${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
}

export function dataRelativa(ms) {
  const d = new Date(ms);
  const agora = new Date();
  const dif = (agora.getTime() - d.getTime()) / 1000;
  if (dif < 60) return 'agora mesmo';
  if (dif < 3600) return `há ${Math.floor(dif / 60)} min`;
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === agora.toDateString()) return `hoje às ${hora}`;
  const ontem = new Date(agora); ontem.setDate(agora.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return `ontem às ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} às ${hora}`;
}

/** "20240131" -> "31 de jan. de 2024" */
export function dataDoVideo(aaaammdd) {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(aaaammdd || ''));
  if (!m) return '';
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 1234567 -> "1,2 mi de visualizações" */
export function visualizacoes(n) {
  if (!n) return '';
  if (n >= 1e9) return `${(n / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi de visualizações`;
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi de visualizações`;
  if (n >= 1e3) return `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil visualizações`;
  return plural(n, 'visualização', 'visualizações');
}

/** Caminho longo do Windows -> "Downloads › SalvaTudo › Vídeos" (as 3 últimas partes). */
export function caminhoCurto(caminho, partes = 3) {
  const p = String(caminho || '').split(/[\\/]+/).filter(Boolean);
  if (p.length <= partes) return p.join(' › ');
  return `… › ${p.slice(-partes).join(' › ')}`;
}

/** Guarda preferências pequenas do navegador sem quebrar quando o armazenamento está bloqueado. */
export const preferencias = {
  ler(chave, padrao) {
    try {
      const v = localStorage.getItem(`salvatudo-${chave}`);
      return v == null ? padrao : JSON.parse(v);
    } catch (_) { return padrao; }
  },
  gravar(chave, valor) {
    try { localStorage.setItem(`salvatudo-${chave}`, JSON.stringify(valor)); } catch (_) { /* sem armazenamento */ }
  },
};
