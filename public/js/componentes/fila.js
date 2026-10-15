import { html, useState, useEffect, useRef, cx, tamanho, velocidade, faltam, duracao, caminhoCurto, plural } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar, useLoja } from '../loja.js';
import { SeloSite, Capa, Confirmar } from './base.js';
import { confeteEm, recolher, useListaFluida, useNumeroSuave, useAnterior } from '../animacoes.js';

const ORDEM = { baixando: 0, finalizando: 0, aguardando: 1, pausado: 2, erro: 3, cancelado: 4, concluido: 5 };

/** Andando primeiro, depois a fila na ordem, e os prontos (mais novos em cima). */
function ordenar(itens) {
  return [...itens].sort((a, b) => {
    const d = ORDEM[a.estado] - ORDEM[b.estado];
    if (d) return d;
    if (a.estado === 'concluido') return (b.concluidoEm || 0) - (a.concluidoEm || 0);
    return a.ordem - b.ordem;
  });
}

const acao = (id, nome) => api.post(`/fila/${id}/${nome}`).catch((e) => avisar(e.message, 'erro'));

const ICONE_TIPO = { video: 'video', audio: 'musica', fotos: 'imagens' };

function linhaProgresso(item) {
  const p = item.progresso || {};
  if (item.estado === 'aguardando') return p.pct ? `Na fila · ${Math.floor(p.pct)}% já baixado` : 'Na fila, já já começa';
  if (item.estado === 'pausado') return `Pausado${p.pct ? ` em ${Math.floor(p.pct)}%` : ''}`;
  if (item.estado === 'finalizando') return `${p.etapa || 'Finalizando'}…`;
  if (item.estado === 'baixando') {
    const partes = [];
    if (p.etapa && p.etapa !== 'Baixando') partes.push(p.etapa + (p.parte ? ` (${p.parte.atual}/${p.parte.de})` : ''));
    if (p.total) partes.push(`${tamanho(p.baixado)} de ${tamanho(p.total)}`);
    else if (p.baixado) partes.push(tamanho(p.baixado));
    if (p.velocidade) partes.push(velocidade(p.velocidade));
    if (p.eta != null) partes.push(faltam(p.eta));
    return partes.join(' · ') || 'Conectando…';
  }
  return '';
}

/** Anel de progresso por cima da capa, com a porcentagem no meio. */
function AnelProgresso({ pct, girando, pausado }) {
  const suave = useNumeroSuave(pct);
  const raio = 17;
  const volta = 2 * Math.PI * raio;
  return html`<div class=${cx('anel-progresso', girando && 'girando', pausado && 'pausado')}>
    <svg viewBox="0 0 44 44" width="46" height="46" aria-hidden="true">
      <circle class="anel-fundo" cx="22" cy="22" r=${raio} />
      <circle class="anel-valor" cx="22" cy="22" r=${raio} stroke-dasharray=${volta}
        stroke-dashoffset=${girando ? volta * 0.72 : volta * (1 - suave / 100)} />
    </svg>
    ${pausado ? html`<span><${Icone} nome="pausa" tam=${14} /></span>` : !girando && html`<span>${Math.floor(suave)}<small>%</small></span>`}
  </div>`;
}

function ItemFila({ item }) {
  const [detalhe, setDetalhe] = useState(false);
  const [festa, setFesta] = useState(false);
  const { sistema } = useLoja();
  const caixa = useRef(null);
  const marca = useRef(null);
  const anterior = useAnterior(item.estado);
  const p = item.progresso || {};
  const andando = item.estado === 'baixando' || item.estado === 'finalizando';
  const pct = item.estado === 'concluido' ? 100 : Math.max(0, Math.min(100, p.pct || 0));
  const indeterminado = item.estado === 'finalizando' || (item.estado === 'baixando' && !p.pct && !p.baixado);
  const pctSuave = useNumeroSuave(pct);
  const pedido = item.pedido || {};
  const formato = item.formato || (pedido.tipo === 'audio' ? (pedido.formatoAudio === 'original' ? 'Áudio original' : pedido.formatoAudio.toUpperCase())
    : pedido.tipo === 'fotos' ? 'Fotos' : `${pedido.formatoVideo.toUpperCase()}${pedido.qualidade !== 'max' ? ` · até ${pedido.qualidade}p` : ''}`);
  const contas = sistema && sistema.contas;
  const site = item.conta && contas && contas.disponivel && contas.sites.find((s) => s.id === item.conta);

  // acabou de terminar (vendo acontecer, não ao abrir o app): festa
  useEffect(() => {
    if (item.estado !== 'concluido' || !anterior || anterior === 'concluido') return undefined;
    setFesta(true);
    requestAnimationFrame(() => confeteEm(marca.current, { quantidade: 22, forca: 0.8 }));
    const t = setTimeout(() => setFesta(false), 1800);
    return () => clearTimeout(t);
  }, [item.estado]);

  const tirar = async () => {
    await recolher(caixa.current, 240);
    api.del(`/fila/${item.id}`).catch((e) => avisar(e.message, 'erro'));
  };

  const conectar = async () => {
    try {
      const r = await api.post(`/contas/${site.id}/entrar`);
      if (r.conectou) { avisar(`Conta do ${site.nome} conectada. Tentando de novo…`, 'ok'); acao(item.id, 'tentar'); }
    } catch (e) { avisar(e.message, 'erro'); }
  };

  return html`<div ref=${caixa} data-chave=${item.id} class=${cx('item-fila', `estado-${item.estado}`, festa && 'festa')}>
    <${Capa} src=${item.miniatura} icone=${ICONE_TIPO[pedido.tipo] || 'video'} duracao=${andando ? '' : duracao(item.duracao)} classe="fila" vertical=${pedido.tipo === 'fotos'}>
      <span class="capa-tipo"><${Icone} nome=${ICONE_TIPO[pedido.tipo] || 'video'} tam=${12} /></span>
      ${(andando || item.estado === 'pausado' || item.estado === 'aguardando') && html`<div class="capa-veu">
        ${item.estado === 'aguardando'
          ? html`<span class="na-fila"><i></i><i></i><i></i></span>`
          : html`<${AnelProgresso} pct=${pct} girando=${indeterminado} pausado=${item.estado === 'pausado'} />`}
      </div>`}
      ${item.estado === 'concluido' && html`<span class="capa-ok" ref=${marca}><${Icone} nome="check" tam=${15} espessura=${3} /></span>`}
    <//>
    <div class="item-corpo">
      <div class="item-topo">
        <div class="item-titulo" title=${item.titulo}>${item.titulo}</div>
        <div class="item-acoes">
          ${andando || item.estado === 'aguardando' ? html`<button class="btn-icone p" title="Pausar" onClick=${() => acao(item.id, 'pausar')}><${Icone} nome="pausa" tam=${15} /></button>` : null}
          ${item.estado === 'pausado' && html`<button class="btn-icone p destaque" title="Continuar" onClick=${() => acao(item.id, 'retomar')}><${Icone} nome="play" tam=${15} /></button>`}
          ${(item.estado === 'erro' || item.estado === 'cancelado') && html`<button class="btn-icone p" title="Tentar de novo" onClick=${() => acao(item.id, 'tentar')}><${Icone} nome="recarregar" tam=${15} /></button>`}
          ${item.estado === 'concluido' && html`
            <button class="btn btn-p btn-abrir" onClick=${() => acao(item.id, 'abrir')}><${Icone} nome=${pedido.tipo === 'fotos' ? 'pastaAberta' : 'play'} tam=${14} /> Abrir</button>
            <button class="btn-icone p" title="Mostrar na pasta" onClick=${() => acao(item.id, 'mostrar')}><${Icone} nome="pasta" tam=${15} /></button>`}
          ${['concluido', 'erro', 'cancelado', 'pausado'].includes(item.estado)
            ? html`<button class="btn-icone p" title="Tirar da lista" onClick=${tirar}><${Icone} nome="x" tam=${15} /></button>`
            : html`<button class="btn-icone p" title="Cancelar" onClick=${() => acao(item.id, 'cancelar')}><${Icone} nome="x" tam=${15} /></button>`}
        </div>
      </div>
      <div class="item-meta">
        <${SeloSite} url=${item.url} extrator=${item.site} p=${true} />
        ${item.canal && html`<span>${item.canal}</span>`}
        <span class="item-formato">${formato}</span>
        ${item.grupo && html`<span class="item-grupo" title=${item.grupo.titulo}><${Icone} nome="lista" tam=${12} /> ${item.grupo.titulo}</span>`}
      </div>

      ${item.estado === 'concluido'
        ? html`<div class="item-pronto">
            <span class="item-pronto-icone"><${Icone} nome="okCirculo" tam=${15} /></span>
            <span>${item.jaExistia ? 'Já estava baixado' : 'Pronto'}${item.tamanho ? ` · ${tamanho(item.tamanho)}` : ''}</span>
            <span class="item-caminho" title=${item.arquivo}>${caminhoCurto(item.arquivo, 3)}</span>
          </div>`
        : item.estado === 'erro'
          ? html`<div class="item-erro">
              <${Icone} nome="erro" tam=${15} />
              <span>${item.erro}</span>
              ${site && html`<button class="link" onClick=${conectar}>Conectar ${site.nome}</button>`}
              ${item.detalhe && html`<button class="link" onClick=${() => setDetalhe(!detalhe)}>${detalhe ? 'menos' : 'detalhes'}</button>`}
            </div>
            ${detalhe && html`<code class="detalhe-tecnico">${item.detalhe}</code>`}`
          : item.estado === 'cancelado'
            ? html`<div class="item-status">Cancelado</div>`
            : html`<div class="item-progresso">
                <div class=${cx('barra', indeterminado && 'indeterminada', item.estado === 'pausado' && 'pausada')}>
                  <div class="barra-preenche" style=${`width:${pctSuave}%`}></div>
                </div>
                <div class="item-status">
                  <span>${linhaProgresso(item)}</span>
                  ${andando && !indeterminado && html`<b>${Math.floor(pctSuave)}%</b>`}
                </div>
              </div>`}
    </div>
  </div>`;
}

export function Fila() {
  const { fila } = useLoja();
  const [confirmar, setConfirmar] = useState(false);
  const lista = useRef(null);
  const itens = ordenar(Object.values(fila));
  const conta = (estados) => itens.filter((i) => estados.includes(i.estado)).length;
  const ativos = conta(['baixando', 'finalizando', 'aguardando']);
  const pausados = conta(['pausado']);
  const erros = conta(['erro']);
  const prontos = conta(['concluido', 'cancelado']);
  useListaFluida(lista, itens.map((i) => `${i.id}:${i.estado}`).join('|'));

  const todos = (nome) => api.post(`/fila/todos/${nome}`).catch((e) => avisar(e.message, 'erro'));

  return html`<section class="secao-fila" id="fila">
    <div class="secao-cab">
      <h2>Downloads</h2>
      <span class="secao-resumo">${itens.length
        ? [ativos && `${ativos} em andamento`, pausados && plural(pausados, 'pausado', 'pausados'), erros && plural(erros, 'com erro', 'com erro'), prontos && plural(prontos, 'pronto', 'prontos')].filter(Boolean).join(' · ')
        : ''}</span>
      <div class="secao-acoes">
        ${ativos > 0 && html`<button class="btn btn-p btn-fantasma" onClick=${() => todos('pausar')}><${Icone} nome="pausa" tam=${14} /> Pausar tudo</button>`}
        ${pausados > 0 && html`<button class="btn btn-p btn-fantasma" onClick=${() => todos('retomar')}><${Icone} nome="play" tam=${14} /> Continuar tudo</button>`}
        ${erros > 1 && html`<button class="btn btn-p btn-fantasma" onClick=${() => todos('tentar-erros')}><${Icone} nome="recarregar" tam=${14} /> Tentar os erros</button>`}
        ${prontos > 0 && html`<button class="btn btn-p btn-fantasma" onClick=${() => (prontos > 5 ? setConfirmar(true) : todos('limpar'))}><${Icone} nome="check" tam=${14} /> Limpar prontos</button>`}
      </div>
    </div>
    ${itens.length
      ? html`<div class="lista-fila" ref=${lista}>${itens.map((i) => html`<${ItemFila} key=${i.id} item=${i} />`)}</div>`
      : html`<div class="fila-vazia">
          <span class="fila-vazia-icone"><${Icone} nome="baixar" tam=${26} /></span>
          <strong>Seus downloads aparecem aqui</strong>
          <span>Cole um link acima. Dá para colar vários de uma vez, um por linha.</span>
        </div>`}
    ${confirmar && html`<${Confirmar} titulo="Limpar a lista?" texto=${`Tira ${plural(prontos, 'item pronto', 'itens prontos')} da lista. Os arquivos continuam nas pastas e no Histórico.`}
      rotulo="Limpar" aoConfirmar=${() => todos('limpar')} aoFechar=${() => setConfirmar(false)} />`}
  </section>`;
}
