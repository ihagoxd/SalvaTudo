import { html, useEffect, useRef, cx, tamanho } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar } from '../loja.js';
import { Anel } from './base.js';

/**
 * Primeira vez: baixa o yt-dlp e o FFmpeg (cerca de 100 MB) com progresso.
 * Começa sozinha, sem a pessoa precisar clicar.
 */
export function Preparar({ c }) {
  const pedido = useRef(false);
  const iniciar = () => api.post('/componentes/instalar').catch((e) => avisar(e.message, 'erro'));

  useEffect(() => {
    if (!pedido.current && !c.instalando && !c.erro) {
      pedido.current = true;
      iniciar();
    }
  }, []);

  const i = c.instalando;
  const etapa = (nome, rotulo, detalhe) => {
    const ok = c[nome] && c[nome].ok;
    const agora = i && i.componente === nome;
    const pct = agora && i.total ? Math.floor((i.baixado / i.total) * 100) : null;
    return html`<div class=${cx('etapa', ok && 'ok', agora && 'agora')}>
      <span class="etapa-icone">${ok ? html`<${Icone} nome="check" tam=${16} />` : agora ? html`<${Anel} tam="p" />` : html`<span class="etapa-ponto"></span>`}</span>
      <div class="etapa-texto">
        <strong>${rotulo}</strong>
        <small>${ok ? `Pronto · versão ${c[nome].versao}` : agora ? `${i.etapa}${i.total ? ` · ${tamanho(i.baixado)} de ${tamanho(i.total)}` : ''}` : detalhe}</small>
        ${agora && html`<div class=${cx('barra', pct == null && 'indeterminada')}><div class="barra-preenche" style=${`width:${pct || 0}%`}></div></div>`}
      </div>
    </div>`;
  };

  return html`<div class="preparar">
    <div class="preparar-caixa entrar">
      <img class="preparar-logo" src="/icones/salvatudo.svg" alt="" />
      <h1>Preparando o SalvaTudo</h1>
      <p>Só na primeira vez: baixando os dois motores que fazem o trabalho pesado (cerca de 100 MB), direto das páginas oficiais.</p>
      <div class="etapas">
        ${etapa('ytdlp', 'yt-dlp', 'Entende o YouTube, Instagram, TikTok e mais 1.700 sites')}
        ${etapa('ffmpeg', 'FFmpeg', 'Junta vídeo e áudio sem perder qualidade')}
      </div>
      ${c.erro && html`<div class="alerta erro"><${Icone} nome="erro" tam=${17} /><div>${c.erro}</div></div>`}
      ${c.erro && html`<button class="btn btn-primario btn-g" onClick=${iniciar}><${Icone} nome="recarregar" tam=${17} /> Tentar de novo</button>`}
    </div>
  </div>`;
}
