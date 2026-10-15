import { html, useState, useEffect, useRef, cx, tamanho, duracao, plural } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar, useLoja, mudar } from '../loja.js';
import { SeloSite, Capa, Confirmar, Segmentado, ir } from './base.js';

const ICONE_TIPO = { video: 'video', audio: 'musica', fotos: 'imagens' };

/** "Hoje", "Ontem", "Esta semana", "outubro de 2026"... */
function grupoData(ms) {
  const d = new Date(ms);
  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
  if (ms >= inicioHoje) return 'Hoje';
  if (ms >= inicioHoje - 86400000) return 'Ontem';
  if (ms >= inicioHoje - 6 * 86400000) return 'Esta semana';
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

export function Historico() {
  const { historicoVersao } = useLoja();
  const [busca, setBusca] = useState('');
  const [tipo, setTipo] = useState('');
  const [dados, setDados] = useState(null);
  const [confirmar, setConfirmar] = useState(false);
  const campo = useRef(null);

  const carregar = async () => {
    try {
      const d = await api.get(`/historico?busca=${encodeURIComponent(busca)}&tipo=${tipo}`);
      setDados(d);
    } catch (e) { avisar(e.message, 'erro'); }
  };

  useEffect(() => {
    const t = setTimeout(carregar, busca ? 180 : 0);
    return () => clearTimeout(t);
  }, [busca, tipo, historicoVersao]);

  const acao = (id, nome) => api.post(`/historico/${id}/${nome}`).catch((e) => avisar(e.message, 'erro'));
  const remover = async (id) => { await api.del(`/historico/${id}`); carregar(); };
  const deNovo = (url) => { mudar((e) => { e.pedidoLink = url; }); ir('/baixar'); };

  const grupos = [];
  for (const r of (dados && dados.itens) || []) {
    const g = grupoData(r.concluidoEm);
    if (!grupos.length || grupos[grupos.length - 1].titulo !== g) grupos.push({ titulo: g, itens: [] });
    grupos[grupos.length - 1].itens.push(r);
  }

  return html`<div class="pagina">
    <div class="pagina-topo">
      <div>
        <h1>Histórico</h1>
        <p>${dados ? plural(dados.total, 'download feito neste computador', 'downloads feitos neste computador') : 'Carregando…'}</p>
      </div>
      ${dados && dados.total > 0 && html`<button class="btn btn-p btn-fantasma" onClick=${() => setConfirmar(true)}><${Icone} nome="lixo" tam=${14} /> Limpar histórico</button>`}
    </div>

    <div class="historico-barra">
      <label class="campo-busca">
        <${Icone} nome="busca" tam=${17} />
        <input ref=${campo} type="search" placeholder="Procurar por título, canal ou site" value=${busca} onInput=${(e) => setBusca(e.currentTarget.value)} />
      </label>
      <${Segmentado} rotulo="Tipo" valor=${tipo} aoMudar=${setTipo} opcoes=${[
        { valor: '', rotulo: 'Tudo' },
        { valor: 'video', rotulo: 'Vídeos', icone: 'video' },
        { valor: 'audio', rotulo: 'Músicas', icone: 'musica' },
        { valor: 'fotos', rotulo: 'Fotos', icone: 'imagem' },
      ]} />
    </div>

    ${dados && !dados.itens.length && html`<div class="vazio-estado">
      <span class="fila-vazia-icone"><${Icone} nome=${busca || tipo ? 'busca' : 'relogio'} tam=${26} /></span>
      <strong>${busca || tipo ? 'Nada encontrado' : 'Nada baixado ainda'}</strong>
      <span>${busca || tipo ? 'Tente outra palavra ou outro filtro.' : 'Tudo o que você baixar fica listado aqui, para achar depois.'}</span>
    </div>`}

    ${grupos.map((g) => html`<section class="grupo-historico" key=${g.titulo}>
      <h3 class="grupo-titulo">${g.titulo}</h3>
      <div class="lista-historico">
        ${g.itens.map((r) => html`<div class=${cx('linha-historico', !r.existe && 'sumiu')} key=${r.id}>
          <${Capa} src=${r.miniatura} icone=${ICONE_TIPO[r.tipo]} duracao=${duracao(r.duracao)} classe="fila" vertical=${r.tipo === 'fotos'} />
          <div class="item-corpo">
            <div class="item-titulo" title=${r.titulo}>${r.titulo}</div>
            <div class="item-meta">
              <${SeloSite} url=${r.url} extrator=${r.site} p=${true} />
              ${r.canal && html`<span>${r.canal}</span>`}
              <span class="item-formato">${r.formato}</span>
              ${r.tamanho ? html`<span>${tamanho(r.tamanho)}</span>` : null}
              <span>${new Date(r.concluidoEm).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              ${!r.existe && html`<span class="selo aviso">arquivo não encontrado</span>`}
            </div>
          </div>
          <div class="item-acoes">
            ${r.existe && html`<button class="btn btn-p btn-abrir" onClick=${() => acao(r.id, 'abrir')}><${Icone} nome=${r.tipo === 'fotos' ? 'pastaAberta' : 'play'} tam=${14} /> Abrir</button>
              <button class="btn-icone p" title="Mostrar na pasta" onClick=${() => acao(r.id, 'mostrar')}><${Icone} nome="pasta" tam=${15} /></button>`}
            <button class="btn-icone p" title="Baixar de novo" onClick=${() => deNovo(r.url)}><${Icone} nome="recarregar" tam=${15} /></button>
            <button class="btn-icone p" title="Tirar do histórico (o arquivo continua na pasta)" onClick=${() => remover(r.id)}><${Icone} nome="x" tam=${15} /></button>
          </div>
        </div>`)}
      </div>
    </section>`)}
    ${dados && dados.encontrados > dados.itens.length && html`<p class="nota-centro">Mostrando os ${dados.itens.length} mais recentes. Use a busca para achar os outros.</p>`}

    ${confirmar && html`<${Confirmar} titulo="Limpar o histórico?" perigo=${true}
      texto="A lista de downloads é apagada. Os arquivos continuam nas pastas, nada é apagado do computador."
      rotulo="Limpar histórico" aoConfirmar=${async () => { await api.post('/historico/limpar'); carregar(); }} aoFechar=${() => setConfirmar(false)} />`}
  </div>`;
}
