import { html, useState, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { useLoja, api, avisar } from '../loja.js';
import { ir, Credito } from './base.js';

function lerTema() {
  try { return localStorage.getItem('salvatudo-tema') || 'sistema'; } catch (_) { return 'sistema'; }
}

function aplicarTema(tema) {
  const raiz = document.documentElement;
  if (tema === 'claro' || tema === 'escuro') raiz.setAttribute('data-tema', tema);
  else raiz.removeAttribute('data-tema');
  try { localStorage.setItem('salvatudo-tema', tema); } catch (_) { /* sem armazenamento */ }
}

/** Quantos downloads estão andando, para o selo do menu e a barrinha. */
export function resumoFila(fila) {
  const itens = Object.values(fila);
  const andando = itens.filter((i) => i.estado === 'baixando' || i.estado === 'finalizando');
  const esperando = itens.filter((i) => i.estado === 'aguardando').length;
  const pct = andando.length ? andando.reduce((s, i) => s + ((i.progresso && i.progresso.pct) || 0), 0) / andando.length : null;
  return { andando: andando.length, esperando, ativos: andando.length + esperando, pct };
}

export function abrirPasta(qual) {
  api.post('/abrir-pasta', { qual }).catch((e) => avisar(e.message, 'erro'));
}

export function Lateral({ rota }) {
  const { fila, sistema } = useLoja();
  const [tema, setTema] = useState(lerTema());
  const trocarTema = (t) => { setTema(t); aplicarTema(t); };
  const r = resumoFila(fila);
  const historico = sistema ? sistema.historico : 0;

  const item = (tela, rotulo, icone, extra = null) => html`<button class=${cx('nav-item', rota.tela === tela && 'ativo')} onClick=${() => ir(`/${tela}`)}>
    <${Icone} nome=${icone} /><span>${rotulo}</span>${extra}
  </button>`;

  return html`<aside class="lateral">
    <a class="marca" href="#/" aria-label="SalvaTudo — início">
      <img class="marca-logo" src="/icones/salvatudo.svg" alt="" />
      <span>
        <span class="marca-nome"><b>Salva</b>Tudo</span>
        <span class="marca-sub">Vídeos, músicas e fotos</span>
      </span>
    </a>

    <nav class="nav" aria-label="Navegação">
      ${item('baixar', 'Baixar', 'baixar', r.ativos ? html`<span class="nav-contador ativo">${r.ativos}</span>` : null)}
      ${item('historico', 'Histórico', 'relogio', historico ? html`<span class="nav-contador">${historico > 999 ? '999+' : historico}</span>` : null)}
      ${item('config', 'Configurações', 'config')}

      <div class="nav-secao">Suas pastas</div>
      <button class="nav-item" onClick=${() => abrirPasta('videos')}>
        <span class="nav-icone" style="--cor:#6246ea"><${Icone} nome="video" tam=${15} /></span><span>Vídeos</span>
        <${Icone} nome="externo" tam=${13} classe="nav-externo" />
      </button>
      <button class="nav-item" onClick=${() => abrirPasta('musicas')}>
        <span class="nav-icone" style="--cor:#e0457b"><${Icone} nome="musica" tam=${15} /></span><span>Músicas</span>
        <${Icone} nome="externo" tam=${13} classe="nav-externo" />
      </button>
      <button class="nav-item" onClick=${() => abrirPasta('fotos')}>
        <span class="nav-icone" style="--cor:#0f9f8f"><${Icone} nome="imagem" tam=${15} /></span><span>Fotos</span>
        <${Icone} nome="externo" tam=${13} classe="nav-externo" />
      </button>
    </nav>

    <div class="lateral-rodape">
      ${r.ativos > 0 && html`<button class="mini-fila" onClick=${() => { ir('/baixar'); setTimeout(() => document.getElementById('fila')?.scrollIntoView({ behavior: 'smooth' }), 60); }}>
        <div class="mini-fila-topo">
          <span class="anel p"></span>
          <span>${r.andando ? `Baixando ${r.andando}` : 'Na fila'}${r.esperando ? ` · ${r.esperando} esperando` : ''}</span>
          ${r.pct != null && html`<b>${Math.floor(r.pct)}%</b>`}
        </div>
        <div class="barra fina"><div class="barra-preenche" style=${`width:${r.pct || 0}%`}></div></div>
      </button>`}
      <div class="selo-qualidade" title="O vídeo e o áudio originais do site, sem reconverter.">
        <${Icone} nome="diamante" tam=${18} />
        <div>Qualidade original<small>Sem perder nada na conversão</small></div>
      </div>
      <div class="tema-alternador" role="radiogroup" aria-label="Tema">
        <button class=${cx(tema === 'claro' && 'ativo')} onClick=${() => trocarTema('claro')} title="Tema claro" aria-label="Tema claro"><${Icone} nome="sol" tam=${16} /></button>
        <button class=${cx(tema === 'sistema' && 'ativo')} onClick=${() => trocarTema('sistema')} title="Igual ao Windows" aria-label="Tema do sistema"><${Icone} nome="monitor" tam=${16} /></button>
        <button class=${cx(tema === 'escuro' && 'ativo')} onClick=${() => trocarTema('escuro')} title="Tema escuro" aria-label="Tema escuro"><${Icone} nome="lua" tam=${16} /></button>
      </div>
      <${Credito} />
    </div>
  </aside>`;
}
