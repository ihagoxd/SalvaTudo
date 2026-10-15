import { html, useState, useEffect, useRef, cx } from '../lib.js';
import { Icone } from '../icones.js';
import { api, useLoja, mudar } from '../loja.js';
import { DESTAQUES, siteDe } from '../sites.js';
import { useAtalho, ehCampoDeTexto, Logo } from './base.js';
import { CartaoMidia, CartaoLista, CartaoFotos, Esqueleto, ErroAnalise } from './cartoes.js';
import { Fila } from './fila.js';

const ehLink = (t) => /https?:\/\/\S+/i.test(String(t || ''));

/** Links já oferecidos da área de transferência (para não oferecer de novo). */
const oferecidos = new Set();

export function Baixar() {
  const { sistema, pedidoLink } = useLoja();
  const [texto, setTexto] = useState('');
  const [analisando, setAnalisando] = useState(null); // url sendo lida
  const [resultado, setResultado] = useState(null);
  const [erro, setErro] = useState(null);
  const [sugestao, setSugestao] = useState(null);
  const [arrastando, setArrastando] = useState(false);
  const campo = useRef(null);
  const pedidoAtual = useRef(0);
  const cfg = (sistema && sistema.config) || {};

  const analisar = async (valor = texto, { playlist = false } = {}) => {
    const t = String(valor || '').trim();
    if (!t) { campo.current && campo.current.focus(); return; }
    if (!ehLink(t)) { setErro({ mensagem: 'Isso não parece um link. Copie o endereço completo do vídeo (começa com https://).' }); setResultado(null); return; }
    const meu = ++pedidoAtual.current;
    setErro(null);
    setResultado(null);
    setSugestao(null);
    setAnalisando((t.match(/https?:\/\/\S+/i) || [t])[0]);
    try {
      const d = await api.post('/analisar', { url: t, playlist });
      if (meu !== pedidoAtual.current) return; // outro link foi colado no meio
      setResultado(d.resultado);
    } catch (e) {
      if (meu !== pedidoAtual.current) return;
      setErro({ mensagem: e.message, detalhe: e.detalhe, conta: e.conta });
    } finally {
      if (meu === pedidoAtual.current) setAnalisando(null);
    }
  };

  const usar = (valor) => {
    setTexto(valor);
    analisar(valor);
  };

  const limpar = () => {
    pedidoAtual.current += 1;
    setTexto('');
    setResultado(null);
    setErro(null);
    setAnalisando(null);
    setTimeout(() => campo.current && campo.current.focus(), 30);
  };

  // "Baixar de novo" vindo do Histórico
  useEffect(() => {
    if (!pedidoLink) return;
    mudar((e) => { e.pedidoLink = null; });
    usar(pedidoLink);
  }, [pedidoLink]);

  // Voltou para a janela com um link copiado: oferece baixar
  useEffect(() => {
    if (cfg.vigiarAreaTransferencia === false) return undefined;
    let vivo = true;
    const conferir = async () => {
      try {
        const d = await api.get('/area-transferencia');
        if (!vivo || !d.link || oferecidos.has(d.link)) return;
        oferecidos.add(d.link);
        if (d.link !== texto.trim()) setSugestao(d.link);
      } catch (_) { /* sem área de transferência */ }
    };
    conferir();
    window.addEventListener('focus', conferir);
    return () => { vivo = false; window.removeEventListener('focus', conferir); };
  }, [cfg.vigiarAreaTransferencia]);

  // Ctrl+V fora de um campo: cola e já analisa
  useEffect(() => {
    const colar = (e) => {
      if (ehCampoDeTexto(document.activeElement)) return;
      const t = e.clipboardData && e.clipboardData.getData('text');
      if (t && ehLink(t)) { e.preventDefault(); usar(t.trim()); }
    };
    window.addEventListener('paste', colar);
    return () => window.removeEventListener('paste', colar);
  }, []);

  // Arrastar um link do navegador para a janela
  useEffect(() => {
    let contador = 0;
    const tipoLink = (e) => e.dataTransfer && [...e.dataTransfer.types].some((t) => t === 'text/uri-list' || t === 'text/plain');
    const entrar = (e) => { if (tipoLink(e)) { contador += 1; setArrastando(true); e.preventDefault(); } };
    const sair = () => { contador = Math.max(0, contador - 1); if (!contador) setArrastando(false); };
    const sobre = (e) => { if (tipoLink(e)) e.preventDefault(); };
    const soltar = (e) => {
      contador = 0;
      setArrastando(false);
      const t = e.dataTransfer && (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain'));
      if (t && ehLink(t)) { e.preventDefault(); usar(t.split(/\r?\n/).filter((l) => !l.startsWith('#')).join('\n').trim()); }
    };
    window.addEventListener('dragenter', entrar);
    window.addEventListener('dragleave', sair);
    window.addEventListener('dragover', sobre);
    window.addEventListener('drop', soltar);
    return () => {
      window.removeEventListener('dragenter', entrar);
      window.removeEventListener('dragleave', sair);
      window.removeEventListener('dragover', sobre);
      window.removeEventListener('drop', soltar);
    };
  }, []);

  useAtalho((e) => (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l', () => { campo.current && campo.current.select(); });

  const colarDoBotao = async () => {
    try {
      const d = await api.get('/area-transferencia');
      if (d.link) { usar(d.link); return; }
    } catch (_) { /* tenta o navegador */ }
    try {
      const t = await navigator.clipboard.readText();
      if (t) usar(t.trim());
    } catch (_) {
      campo.current && campo.current.focus();
    }
  };

  const linhas = texto.split(/\r?\n/).filter((l) => l.trim()).length;
  const site = siteDe((texto.match(/https?:\/\/\S+/i) || [''])[0]);
  const aoEnviado = limpar;

  let cartao = null;
  if (analisando) cartao = html`<${Esqueleto} url=${analisando} />`;
  else if (erro) cartao = html`<${ErroAnalise} erro=${erro} aoTentar=${() => analisar(texto)} />`;
  else if (resultado && resultado.tipo === 'midia') {
    cartao = html`<${CartaoMidia} key=${resultado.url} resultado=${resultado} aoEnviado=${aoEnviado} aoPlaylist=${() => analisar(texto, { playlist: true })} />`;
  } else if (resultado && (resultado.tipo === 'lista' || resultado.tipo === 'links')) {
    cartao = html`<${CartaoLista} key=${resultado.url || resultado.titulo} resultado=${resultado} aoEnviado=${aoEnviado} />`;
  } else if (resultado && resultado.tipo === 'fotos') {
    cartao = html`<${CartaoFotos} key=${resultado.url} resultado=${resultado} aoEnviado=${aoEnviado} />`;
  }

  return html`<div class="pagina pagina-baixar">
    <section class=${cx('heroi', (resultado || analisando || erro) && 'compacto')}>
      <h1>Baixe vídeos, músicas e fotos</h1>
      <p class="heroi-sub">Na qualidade original, sem marca d'água e já organizados em pastas.</p>

      <form class=${cx('campo-link', site && 'com-site')} style=${site ? `--cor-site:${site.cor}` : ''}
          onSubmit=${(e) => { e.preventDefault(); analisar(); }}>
        <span class="campo-link-icone">${site ? html`<span class="logo-campo" key=${site.id}><${Logo} id=${site.id} tam=${20} /></span>` : html`<${Icone} nome="link" tam=${20} />`}</span>
        <textarea ref=${campo} rows=${Math.min(5, Math.max(1, linhas))} value=${texto} spellcheck=${false}
          placeholder="Cole aqui o link do vídeo, música, playlist ou post…"
          aria-label="Link para baixar"
          onInput=${(e) => setTexto(e.currentTarget.value)}
          onPaste=${(e) => {
            const t = e.clipboardData && e.clipboardData.getData('text');
            // colou num campo vazio: já analisa, sem precisar clicar
            if (t && ehLink(t) && !texto.trim()) { e.preventDefault(); usar(t.trim()); }
          }}
          onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); analisar(); } }}></textarea>
        ${texto && html`<button type="button" class="btn-icone" onClick=${limpar} aria-label="Limpar"><${Icone} nome="x" tam=${17} /></button>`}
        ${!texto && html`<button type="button" class="btn btn-colar" onClick=${colarDoBotao}><${Icone} nome="colar" tam=${16} /> Colar</button>`}
        <button type="submit" class="btn btn-primario btn-buscar" disabled=${Boolean(analisando)}>
          ${analisando ? html`<span class="anel p"></span> Lendo` : html`${linhas > 1 ? `Ver ${linhas} links` : 'Buscar'} <${Icone} nome="seta" tam=${17} />`}
        </button>
      </form>

      ${sugestao && !analisando && html`<button class="sugestao entrar" onClick=${() => usar(sugestao)}>
        <${Icone} nome="colar" tam=${15} />
        <span>Link copiado: <b>${sugestao.replace(/^https?:\/\/(www\.)?/, '').slice(0, 64)}${sugestao.length > 72 ? '…' : ''}</b></span>
        <span class="sugestao-acao">Baixar <${Icone} nome="seta" tam=${14} /></span>
      </button>`}

      ${!resultado && !analisando && !erro && html`<div class="sites">
        <span class="sites-rotulo">Funciona com</span>
        ${DESTAQUES.map((s, i) => html`<span class="site-chip" key=${s.id} style=${`--cor-site:${s.cor};--i:${i}`}><${Logo} id=${s.id} tam=${14} />${s.nome}</span>`)}
        <span class="site-chip mais">+1.700 sites</span>
      </div>`}
    </section>

    ${cartao}

    <${Fila} />

    <p class="aviso-legal">Baixe só o que você tem direito: conteúdo seu, livre ou com permissão de quem fez.</p>

    ${arrastando && html`<div class="soltar-global"><div class="caixa"><${Icone} nome="link" tam=${34} />Solte o link para baixar</div></div>`}
  </div>`;
}

