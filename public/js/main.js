import { html, render, useEffect } from './lib.js';
import { useLoja, conectarEventos, carregarSistema, avisar } from './loja.js';
import { useRota, Toasts, ir } from './componentes/base.js';
import { Lateral, resumoFila } from './componentes/lateral.js';
import { Baixar } from './componentes/baixar.js';
import { Historico } from './componentes/historico.js';
import { Configuracoes } from './componentes/configuracoes.js';
import { Preparar } from './componentes/preparar.js';
import { Icone } from './icones.js';

const TITULOS = { baixar: 'SalvaTudo', historico: 'Histórico · SalvaTudo', config: 'Configurações · SalvaTudo' };

function App() {
  const rota = useRota();
  const { sistema, conectado, fila } = useLoja();
  const r = resumoFila(fila);

  // título da janela: a tela atual, ou o andamento dos downloads
  useEffect(() => {
    document.title = r.andando && r.pct != null ? `${Math.floor(r.pct)}% · baixando ${r.andando} · SalvaTudo` : (TITULOS[rota.tela] || 'SalvaTudo');
  }, [rota.tela, r.andando, r.pct == null ? -1 : Math.floor(r.pct)]);

  useEffect(() => {
    const principal = document.querySelector('.principal');
    if (principal) principal.scrollTop = 0;
  }, [rota.tela]);

  const preparando = sistema && !sistema.componentes.pronto;
  let tela;
  if (preparando) tela = html`<${Preparar} c=${sistema.componentes} />`;
  else if (rota.tela === 'historico') tela = html`<${Historico} />`;
  else if (rota.tela === 'config') tela = html`<${Configuracoes} />`;
  else tela = html`<${Baixar} />`;

  return html`<div class="app">
    <${Lateral} rota=${rota} />
    <${TopoMovel} />
    <main class="principal" id="principal">
      ${sistema && !conectado && html`<div class="pagina" style="padding-bottom:0">
        <div class="alerta aviso"><${Icone} nome="alerta" tam=${17} /><div>Sem conexão com o SalvaTudo. Tentando de novo… Se o programa foi fechado, abra outra vez.</div></div>
      </div>`}
      ${tela}
    </main>
    <${AbasMovel} rota=${rota} ativos=${r.ativos} />
    <${Toasts} />
  </div>`;
}

/* ---------------- janela estreita: barra de cima e abas de baixo ---------------- */

function TopoMovel() {
  return html`<header class="topo-movel">
    <a class="marca" href="#/" aria-label="SalvaTudo">
      <img class="marca-logo" src="/icones/salvatudo.svg" alt="" />
      <span class="marca-nome"><b>Salva</b>Tudo</span>
    </a>
  </header>`;
}

function AbasMovel({ rota, ativos }) {
  const aba = (tela, rotulo, icone, extra = null) => html`<button class=${rota.tela === tela ? 'aba ativo' : 'aba'} onClick=${() => ir(`/${tela}`)}
      aria-current=${rota.tela === tela ? 'page' : undefined}>
    <${Icone} nome=${icone} tam=${22} /><span>${rotulo}</span>${extra}
  </button>`;
  return html`<nav class="abas-movel" aria-label="Navegação">
    ${aba('baixar', 'Baixar', 'baixar', ativos ? html`<span class="aba-contador">${ativos}</span>` : null)}
    ${aba('historico', 'Histórico', 'relogio')}
    ${aba('config', 'Ajustes', 'config')}
  </nav>`;
}

function iniciar() {
  conectarEventos();
  render(html`<${App} />`, document.getElementById('app'));
  if (!location.hash) ir('/baixar');
  carregarSistema().catch(() => avisar('Não consegui falar com o SalvaTudo.', 'erro'));
}

iniciar();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
