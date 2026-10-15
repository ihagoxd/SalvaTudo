import { html, useState, useRef, cx, tamanho, duracao, duracaoLonga, plural, dataDoVideo, visualizacoes, caminhoCurto, dataRelativa } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar, useLoja, escolherPasta, salvarConfig } from '../loja.js';
import { Alerta, Alternar, Segmentado, SeloSite, Capa, Anel, ir } from './base.js';
import { voarParaFila, recolher } from '../animacoes.js';

/* ============================================================
   Escolhas: tipo, qualidade, formato e pasta
   ============================================================ */

const QUALIDADES_GERAIS = [
  { valor: 'max', rotulo: 'Máxima', detalhe: 'A melhor que houver' },
  { valor: '2160', rotulo: '4K', detalhe: 'até 2160p' },
  { valor: '1440', rotulo: '2K', detalhe: 'até 1440p' },
  { valor: '1080', rotulo: '1080p', detalhe: 'Full HD' },
  { valor: '720', rotulo: '720p', detalhe: 'HD' },
  { valor: '480', rotulo: '480p', detalhe: 'leve' },
  { valor: '360', rotulo: '360p', detalhe: 'bem leve' },
];

const FORMATOS_AUDIO = [
  { valor: 'original', titulo: 'Original', ajuda: 'O áudio do site do jeito que ele é, sem conversão. A melhor qualidade.' },
  { valor: 'm4a', titulo: 'M4A (AAC)', ajuda: 'Toca em tudo, inclusive iPhone e carro.' },
  { valor: 'mp3', titulo: 'MP3 320 kbps', ajuda: 'O formato mais conhecido. Converte o áudio.' },
  { valor: 'flac', titulo: 'FLAC', ajuda: 'Sem perdas, bom para edição. Arquivo grande.' },
];

/** Valores iniciais das escolhas, a partir das configurações. */
export function escolhasIniciais(cfg, resultado) {
  const temVideo = !resultado || resultado.tipo !== 'midia' || resultado.temVideo;
  return {
    tipo: temVideo ? (cfg.tipoPadrao || 'video') : 'audio',
    qualidade: resultado && resultado.tipo === 'midia' && resultado.qualidades.length
      ? (cfg.qualidadePadrao === 'max' ? String(resultado.qualidades[0].altura) : (resultado.qualidades.find((q) => q.altura <= Number(cfg.qualidadePadrao)) || resultado.qualidades[resultado.qualidades.length - 1]).altura + '')
      : (cfg.qualidadePadrao || 'max'),
    formatoVideo: cfg.formatoVideo || 'mp4',
    formatoAudio: cfg.formatoAudio || 'original',
    legendas: Boolean(cfg.legendas),
    pasta: null, // null = a pasta padrão do tipo
  };
}

function pastaPadrao(cfg, tipo) {
  return tipo === 'audio' ? cfg.pastaMusicas : tipo === 'fotos' ? cfg.pastaFotos : cfg.pastaVideos;
}

/** Onde o arquivo vai parar, explicado em partes: "Vídeos › Canal". */
function previaPasta(cfg, tipo, resultado, grupo) {
  const partes = [];
  if (grupo) partes.push(grupo);
  else if (tipo === 'fotos') partes.push(resultado.canal || '@autor', resultado.titulo);
  else if (tipo === 'audio') {
    if (cfg.organizarMusicas !== 'nenhuma') partes.push((resultado && (resultado.artista || resultado.canal)) || 'Artista');
    if (cfg.organizarMusicas === 'artista-album' && resultado && resultado.album) partes.push(resultado.album);
  } else if (cfg.organizarVideos === 'canal') partes.push((resultado && resultado.canal) || 'Canal');
  else if (cfg.organizarVideos === 'site') partes.push((resultado && resultado.site) || 'Site', (resultado && resultado.canal) || 'Canal');
  else if (cfg.organizarVideos === 'data') {
    const d = new Date();
    partes.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return partes.filter(Boolean);
}

/** "Salvar em" + botão de trocar a pasta só deste download. */
function OndeSalvar({ cfg, tipo, escolhas, aoMudar, resultado, grupo = null, espaco = null }) {
  const base = escolhas.pasta || pastaPadrao(cfg, tipo);
  const partes = previaPasta(cfg, tipo, resultado, grupo);
  const [livre, setLivre] = useState(espaco);
  const trocar = async () => {
    try {
      const r = await escolherPasta(base);
      if (r) { aoMudar({ pasta: r.pasta }); setLivre(r.espaco); }
    } catch (e) { avisar(e.message, 'erro'); }
  };
  const tornarPadrao = async () => {
    const chave = tipo === 'audio' ? 'pastaMusicas' : tipo === 'fotos' ? 'pastaFotos' : 'pastaVideos';
    await salvarConfig({ [chave]: escolhas.pasta });
    aoMudar({ pasta: null });
    avisar('Pronto: esta é a pasta padrão agora.', 'ok');
  };
  const espacoMostrado = escolhas.pasta ? livre : espaco;
  return html`<div class="onde-salvar">
    <div class="rotulo-campo">Salvar em</div>
    <div class="caminho" title=${[base, ...partes].join('\\')}>
      <span class="caminho-icone"><${Icone} nome="pasta" tam=${16} /></span>
      <span class="caminho-texto">
        <span class="caminho-base">${caminhoCurto(base, 2)}</span>
        ${partes.map((p) => html`<span class="caminho-sep">›</span><span class="caminho-parte">${p}</span>`)}
      </span>
      <button class="btn btn-p" onClick=${trocar}>Trocar</button>
    </div>
    <div class="caminho-rodape">
      ${espacoMostrado != null && html`<span><${Icone} nome="disco" tam=${13} /> ${tamanho(espacoMostrado)} livres</span>`}
      ${escolhas.pasta && html`<button class="link" onClick=${tornarPadrao}>Usar sempre esta pasta</button>`}
      ${escolhas.pasta && html`<button class="link" onClick=${() => aoMudar({ pasta: null })}>Voltar para a padrão</button>`}
    </div>
  </div>`;
}

/** Botões de qualidade (os do vídeo analisado, ou os gerais para listas). */
function Qualidades({ resultado, escolhas, aoMudar }) {
  const midia = resultado && resultado.tipo === 'midia';
  const recomendada = midia && (resultado.qualidades.find((q) => q.altura <= 1080) || {}).altura;
  const lista = midia
    ? resultado.qualidades.map((q, i) => ({
      valor: String(q.altura),
      rotulo: q.rotulo,
      detalhe: [q.detalhe, q.fps ? `${q.fps}fps` : null, q.hdr && escolhas.formatoVideo === 'mkv' ? 'HDR' : null].filter(Boolean).join(' · '),
      tamanho: q.tamanho[escolhas.formatoVideo] || q.tamanho.mkv,
      selo: q.altura === recomendada && i > 0 ? 'Recomendado' : i === 0 ? 'Máxima' : null,
    }))
    : QUALIDADES_GERAIS.map((q) => ({ ...q, selo: q.valor === '1080' ? 'Recomendado' : null }));
  return html`<div class="qualidades" role="radiogroup" aria-label="Qualidade">
    ${lista.map((q, i) => html`<button type="button" key=${q.valor} role="radio" aria-checked=${escolhas.qualidade === q.valor}
        class=${cx('qualidade', escolhas.qualidade === q.valor && 'ativo')} style=${`--i:${i}`} onClick=${() => aoMudar({ qualidade: q.valor })}>
      ${q.selo && html`<span class=${cx('qualidade-selo', q.selo === 'Recomendado' && 'recomendado')}>${q.selo}</span>`}
      <strong>${q.rotulo}</strong>
      <small>${q.detalhe || ' '}</small>
      ${q.tamanho ? html`<em>~${tamanho(q.tamanho)}</em>` : null}
    </button>`)}
  </div>`;
}

function tamanhoAudio(resultado, formato) {
  if (!resultado || resultado.tipo !== 'midia' || !resultado.audio) return null;
  const a = resultado.audio;
  if (formato === 'original') return a.tamanho;
  if (formato === 'm4a') return a.tamanhoAac;
  if (formato === 'mp3' && resultado.duracao) return resultado.duracao * 320 * 125;
  return null;
}

function FormatosAudio({ resultado, escolhas, aoMudar }) {
  const a = resultado && resultado.tipo === 'midia' ? resultado.audio : null;
  return html`<div class="escolhas">
    ${FORMATOS_AUDIO.map((f) => {
      let ajuda = f.ajuda;
      if (f.valor === 'original' && a && a.codec) ajuda = `${a.codec}${a.kbps ? ` ${a.kbps} kbps` : ''}, sem conversão. A melhor qualidade.`;
      if (f.valor === 'm4a' && a && a.codecAac === 'AAC') ajuda = 'AAC original do site, sem conversão. Toca em tudo.';
      const t = tamanhoAudio(resultado, f.valor);
      return html`<button type="button" key=${f.valor} class=${cx('escolha', escolhas.formatoAudio === f.valor && 'ativo')}
          role="radio" aria-checked=${escolhas.formatoAudio === f.valor} onClick=${() => aoMudar({ formatoAudio: f.valor })}>
        <span class="radio"></span>
        <span class="escolha-texto"><strong>${f.titulo}${f.valor === 'original' && html` <span class="selo-recomendado">recomendado</span>`}</strong><small>${ajuda}</small></span>
        ${t ? html`<em class="escolha-tamanho">~${tamanho(t)}</em>` : null}
      </button>`;
    })}
  </div>`;
}

/** Painel de escolhas comum a vídeos, playlists e listas de links. */
function Escolhas({ resultado, escolhas, aoMudar, temVideo = true, legendas = false }) {
  return html`<div class="escolhas-painel">
    ${temVideo
      ? html`<${Segmentado} rotulo="Tipo" valor=${escolhas.tipo} aoMudar=${(tipo) => aoMudar({ tipo })}
          opcoes=${[{ valor: 'video', rotulo: 'Vídeo', icone: 'video' }, { valor: 'audio', rotulo: 'Só o áudio', icone: 'musica' }]} />`
      : html`<div class="aviso-so-audio"><${Icone} nome="musica" tam=${16} /> Este link só tem áudio</div>`}

    ${escolhas.tipo === 'video'
      ? html`<div class="campo">
          <div class="rotulo-campo">Qualidade</div>
          <${Qualidades} resultado=${resultado} escolhas=${escolhas} aoMudar=${aoMudar} />
        </div>
        <div class="campo">
          <div class="rotulo-campo">Formato</div>
          <${Segmentado} rotulo="Formato" valor=${escolhas.formatoVideo} aoMudar=${(formatoVideo) => aoMudar({ formatoVideo })}
            opcoes=${[{ valor: 'mp4', rotulo: 'MP4 · abre em tudo' }, { valor: 'mkv', rotulo: 'MKV · menor e máxima' }]} />
          <p class="ajuda">${escolhas.formatoVideo === 'mp4'
            ? 'Vídeo e áudio originais num MP4, sem reconverter. Abre no celular, na TV, no WhatsApp e em qualquer editor.'
            : 'O codec mais moderno de cada resolução (AV1, HDR quando houver): mesma qualidade, até metade do tamanho. Ideal para guardar e ver no computador (VLC).'}</p>
        </div>
        ${legendas && html`<${Alternar} ligado=${escolhas.legendas} aoMudar=${(v) => aoMudar({ legendas: v })}
            titulo="Legendas em português" ajuda="Embutidas no vídeo (quando o site oferece)." />`}`
      : html`<div class="campo">
          <div class="rotulo-campo">Formato do áudio</div>
          <${FormatosAudio} resultado=${resultado} escolhas=${escolhas} aoMudar=${aoMudar} />
        </div>`}
  </div>`;
}

/* ============================================================
   Envio para a fila
   ============================================================ */

/**
 * Manda para a fila com festa: o botão vira "Adicionado!", a capa voa até a
 * lista de downloads e o cartão se recolhe.
 */
function useEnvio(aoEnviado) {
  const cartao = useRef(null);
  const [fase, setFase] = useState('livre'); // livre | enviando | feito
  const mandar = async (corpo) => {
    setFase('enviando');
    try {
      const r = await api.post('/baixar', corpo);
      if (!r.adicionados) { avisar('Isso já está na fila de downloads.', 'aviso'); setFase('livre'); return; }
      setFase('feito');
      const el = cartao.current;
      await Promise.all([voarParaFila(el && el.querySelector('.capa-midia')), new Promise((ok) => setTimeout(ok, 480))]);
      await recolher(el, 300);
      if (r.adicionados > 1 || r.repetidos) {
        avisar(`${r.adicionados} ${r.adicionados === 1 ? 'download' : 'downloads'} na fila.`, 'ok', {
          titulo: r.repetidos ? `${r.repetidos} já estava${r.repetidos > 1 ? 'm' : ''} na fila` : undefined,
        });
      }
      aoEnviado();
      setTimeout(() => document.getElementById('fila')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (e) {
      avisar(e.message, 'erro');
      setFase('livre');
    }
  };
  return { cartao, fase, mandar };
}

function BotaoBaixar({ fase, aoClicar, desativado = false, children }) {
  return html`<button class=${cx('btn btn-primario btn-g btn-bloco btn-baixar', fase === 'feito' && 'feito')}
      onClick=${aoClicar} disabled=${desativado || fase !== 'livre'}>
    ${fase === 'feito'
      ? html`<span class="feito-conteudo"><${Icone} nome="check" tam=${21} espessura=${3} /> Adicionado!</span>`
      : html`${fase === 'enviando' ? html`<${Anel} tam="p" />` : html`<${Icone} nome="baixar" tam=${19} classe="icone-baixar" />`}${children}`}
  </button>`;
}

function corpoEscolhas(escolhas) {
  return {
    tipo: escolhas.tipo,
    qualidade: escolhas.qualidade,
    formatoVideo: escolhas.formatoVideo,
    formatoAudio: escolhas.formatoAudio,
    legendas: escolhas.legendas,
    pasta: escolhas.pasta || undefined,
  };
}

function useEscolhas(resultado) {
  const { sistema } = useLoja();
  const cfg = (sistema && sistema.config) || {};
  const [escolhas, setEscolhas] = useState(() => escolhasIniciais(cfg, resultado));
  const mudar = (parcial) => setEscolhas((e) => ({ ...e, ...parcial }));
  return [escolhas, mudar, cfg, sistema];
}

function JaBaixado({ registro }) {
  if (!registro) return null;
  const abrir = () => api.post(`/historico/${registro.id}/mostrar`).catch((e) => avisar(e.message, 'erro'));
  return html`<${Alerta} nivel="info">
    Você já baixou isto ${dataRelativa(registro.quando)} (${registro.formato}).
    <button class="link" onClick=${abrir}>Mostrar na pasta</button>
  <//>`;
}

/* ============================================================
   Um vídeo ou música
   ============================================================ */

export function CartaoMidia({ resultado: r, aoEnviado, aoPlaylist }) {
  const [escolhas, mudar, cfg, sistema] = useEscolhas(r);
  const { cartao, fase, mandar } = useEnvio(aoEnviado);
  const espaco = sistema && sistema.espaco ? (escolhas.tipo === 'audio' ? sistema.espaco.musicas : sistema.espaco.videos) : null;

  const qualidade = r.qualidades.find((q) => String(q.altura) === escolhas.qualidade);
  const total = escolhas.tipo === 'video'
    ? qualidade && (qualidade.tamanho[escolhas.formatoVideo] || qualidade.tamanho.mkv)
    : tamanhoAudio(r, escolhas.formatoAudio);
  const bloqueado = r.aoVivo || r.emBreve;

  const baixar = () => mandar({
    ...corpoEscolhas(escolhas),
    itens: [{ url: r.url, titulo: r.titulo, miniatura: r.miniatura, canal: r.canal, duracao: r.duracao, site: r.site, chave: r.chave }],
  });

  const meta = [r.canal, visualizacoes(r.visualizacoes), dataDoVideo(r.data)].filter(Boolean);
  return html`<div class="cartao-resultado entrar" ref=${cartao}>
    <div class="resultado-midia">
      <${Capa} src=${r.miniatura} duracao=${duracao(r.duracao)} icone=${r.temVideo ? 'video' : 'musica'} classe="grande" />
      <div class="resultado-info">
        <${SeloSite} url=${r.url} extrator=${r.site} />
        <h2 class="resultado-titulo">${r.titulo}</h2>
        <p class="resultado-meta">${meta.join(' · ')}</p>
        ${r.artista && r.album && html`<p class="resultado-meta"><${Icone} nome="musica" tam=${13} /> ${r.artista} — ${r.album}</p>`}
        <div class="selos-qualidade">
          ${r.qualidades[0] && html`<span class="selo destaque">${r.qualidades[0].rotulo}${r.qualidades[0].fps ? ` ${r.qualidades[0].fps}fps` : ''}</span>`}
          ${r.qualidades.some((q) => q.hdr) && html`<span class="selo">HDR</span>`}
          ${r.audio && r.audio.kbps && html`<span class="selo">${r.audio.codec} ${r.audio.kbps} kbps</span>`}
          ${r.legendas && html`<span class="selo"><${Icone} nome="legenda" tam=${12} /> Legendas</span>`}
        </div>
      </div>
    </div>

    ${r.temPlaylist && html`<${Alerta} nivel="info">
      Este vídeo faz parte de uma playlist.
      <button class="link" onClick=${aoPlaylist}>Ver a playlist inteira</button>
    <//>`}
    <${JaBaixado} registro=${r.jaBaixado} />
    ${r.aoVivo && html`<${Alerta} nivel="aviso">É uma transmissão ao vivo. Espere terminar para baixar o vídeo completo.<//>`}
    ${r.emBreve && html`<${Alerta} nivel="aviso">Essa transmissão ou estreia ainda não começou.<//>`}

    <div class="resultado-corpo">
      <${Escolhas} resultado=${r} escolhas=${escolhas} aoMudar=${mudar} temVideo=${r.temVideo} legendas=${r.legendas} />
      <div class="resultado-lado">
        <${OndeSalvar} cfg=${cfg} tipo=${escolhas.tipo} escolhas=${escolhas} aoMudar=${mudar} resultado=${r} espaco=${espaco} />
        <${BotaoBaixar} fase=${fase} aoClicar=${baixar} desativado=${bloqueado}>
          ${escolhas.tipo === 'video' ? 'Baixar vídeo' : 'Baixar áudio'}
          ${total ? html`<span class="btn-detalhe">~${tamanho(total)}</span>` : null}
        <//>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   Playlist, álbum, canal ou vários links
   ============================================================ */

const POR_PAGINA = 150;

export function CartaoLista({ resultado: r, aoEnviado }) {
  const [escolhas, mudar, cfg, sistema] = useEscolhas(r);
  const ehLinks = r.tipo === 'links';
  const disponiveis = r.itens.filter((i) => !i.indisponivel);
  const [marcados, setMarcados] = useState(() => new Set(disponiveis.filter((i) => !i.jaBaixado).map((i) => i.indice)));
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [usarPasta, setUsarPasta] = useState(!ehLinks);
  const { cartao, fase, mandar } = useEnvio(aoEnviado);
  const jaBaixados = r.itens.filter((i) => i.jaBaixado).length;

  const alternar = (indice) => setMarcados((m) => {
    const n = new Set(m);
    if (n.has(indice)) n.delete(indice); else n.add(indice);
    return n;
  });
  const todos = () => setMarcados(new Set(disponiveis.map((i) => i.indice)));
  const nenhum = () => setMarcados(new Set());
  const faltam = () => setMarcados(new Set(disponiveis.filter((i) => !i.jaBaixado).map((i) => i.indice)));

  const escolhidos = r.itens.filter((i) => marcados.has(i.indice));
  const nome = escolhas.tipo === 'audio' ? ['música', 'músicas'] : ['vídeo', 'vídeos'];
  const espaco = sistema && sistema.espaco ? (escolhas.tipo === 'audio' ? sistema.espaco.musicas : sistema.espaco.videos) : null;

  const baixar = () => mandar({
    ...corpoEscolhas(escolhas),
    grupo: usarPasta && !ehLinks ? { id: r.id, titulo: r.titulo, quantidade: r.quantidade } : null,
    itens: escolhidos.map((i) => ({ url: i.url, titulo: i.titulo === i.url ? undefined : i.titulo, miniatura: i.miniatura, canal: i.canal, duracao: i.duracao, chave: i.chave, indice: i.indice })),
  });

  return html`<div class="cartao-resultado entrar" ref=${cartao}>
    <div class="resultado-midia lista">
      ${ehLinks
        ? html`<div class="capa-midia grande capa-links"><span class="capa-reserva"><${Icone} nome="links" tam=${34} /></span></div>`
        : html`<${Capa} src=${r.miniatura} icone="lista" classe="grande"><span class="capa-pilha">${plural(r.quantidade, 'item', 'itens')}</span><//>`}
      <div class="resultado-info">
        ${!ehLinks && html`<${SeloSite} url=${r.url} extrator=${r.site} />`}
        <h2 class="resultado-titulo">${ehLinks ? `${r.quantidade} links colados` : r.titulo}</h2>
        <p class="resultado-meta">${ehLinks
          ? 'Cada um descobre o título e a capa na hora de baixar.'
          : [r.canal, plural(r.quantidade, 'item', 'itens'), duracaoLonga(r.duracaoTotal)].filter(Boolean).join(' · ')}</p>
        ${jaBaixados > 0 && html`<p class="resultado-meta destaque-ok"><${Icone} nome="okCirculo" tam=${14} /> ${plural(jaBaixados, 'já foi baixado', 'já foram baixados')} antes (desmarcados)</p>`}
      </div>
    </div>

    <div class="resultado-corpo">
      <div>
        <${Escolhas} resultado=${r} escolhas=${escolhas} aoMudar=${mudar} />
        <div class="lista-itens">
          <div class="lista-barra">
            <span><b>${escolhidos.length}</b> de ${disponiveis.length} marcados</span>
            <button class="link" onClick=${todos}>Todos</button>
            <button class="link" onClick=${nenhum}>Nenhum</button>
            ${jaBaixados > 0 && html`<button class="link" onClick=${faltam}>Só os que faltam</button>`}
          </div>
          <div class="lista-rolagem">
            ${r.itens.slice(0, mostrar).map((i) => html`<label key=${i.indice} class=${cx('linha-item', i.indisponivel && 'indisponivel', marcados.has(i.indice) && 'marcado')}>
              <input type="checkbox" checked=${marcados.has(i.indice)} disabled=${i.indisponivel} onChange=${() => alternar(i.indice)} />
              <span class="linha-num">${i.indice}</span>
              ${ehLinks
                ? html`<${SeloSite} url=${i.url} p=${true} />`
                : html`<${Capa} src=${i.miniatura} classe="mini" />`}
              <span class="linha-texto">
                <span class="linha-titulo">${i.titulo}</span>
                ${!ehLinks && (i.canal || i.duracao) && html`<small>${[i.canal, duracao(i.duracao)].filter(Boolean).join(' · ')}</small>`}
              </span>
              ${i.jaBaixado && html`<span class="selo ok">já baixado</span>`}
              ${i.indisponivel && html`<span class="selo">indisponível</span>`}
            </label>`)}
            ${r.itens.length > mostrar && html`<button class="btn btn-p mostrar-mais" onClick=${() => setMostrar((m) => m + POR_PAGINA)}>
              Mostrar mais ${Math.min(POR_PAGINA, r.itens.length - mostrar)}
            </button>`}
          </div>
        </div>
      </div>
      <div class="resultado-lado">
        <${OndeSalvar} cfg=${cfg} tipo=${escolhas.tipo} escolhas=${escolhas} aoMudar=${mudar} resultado=${null}
          grupo=${usarPasta && !ehLinks ? r.titulo : null} espaco=${espaco} />
        ${!ehLinks && html`<${Alternar} ligado=${usarPasta} aoMudar=${setUsarPasta}
          titulo="Pasta própria para a playlist" ajuda=${cfg.numerarPlaylist ? 'Com os arquivos numerados na ordem: 01, 02, 03…' : 'Todos os itens juntos numa pasta com o nome da playlist.'} />`}
        <${BotaoBaixar} fase=${fase} aoClicar=${baixar} desativado=${!escolhidos.length}>
          Baixar ${plural(escolhidos.length, nome[0], nome[1])}
        <//>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   Fotos do TikTok
   ============================================================ */

export function CartaoFotos({ resultado: r, aoEnviado }) {
  const { sistema } = useLoja();
  const cfg = (sistema && sistema.config) || {};
  const [musica, setMusica] = useState(cfg.fotosMusica !== false);
  const [lives, setLives] = useState(cfg.fotosLive !== false);
  const [pasta, setPasta] = useState(null);
  const { cartao, fase, mandar } = useEnvio(aoEnviado);
  const espaco = sistema && sistema.espaco ? sistema.espaco.fotos : null;

  const baixar = () => mandar({
    tipo: 'fotos', musica, lives, pasta: pasta || undefined,
    itens: [{ url: r.url, titulo: r.titulo, miniatura: r.miniatura, canal: r.canal, site: 'TikTok', chave: r.chave }],
  });

  return html`<div class="cartao-resultado entrar" ref=${cartao}>
    <div class="resultado-info fotos-cab">
      <${SeloSite} url=${r.url} />
      <h2 class="resultado-titulo">${r.titulo}</h2>
      <p class="resultado-meta">${[r.canal, plural(r.fotos.length, 'foto', 'fotos'), r.lives ? plural(r.lives, 'Live Photo', 'Live Photos') : null].filter(Boolean).join(' · ')}</p>
      <div class="selos-qualidade">
        <span class="selo destaque"><${Icone} nome="semMarca" tam=${12} /> Sem marca d'água</span>
        <span class="selo">Resolução original</span>
        ${r.fotos[0] && r.fotos[0].largura && html`<span class="selo">${r.fotos[0].largura}×${r.fotos[0].altura}</span>`}
      </div>
    </div>
    <${JaBaixado} registro=${r.jaBaixado} />
    <div class="grade-fotos">
      ${r.fotos.map((f) => html`<div class="foto" key=${f.indice}>
        <${Capa} src=${f.url} icone="imagem" vertical=${true}>
          <span class="foto-num">${f.indice}</span>
          ${f.live && html`<span class="foto-live"><${Icone} nome="live" tam=${12} /> LIVE</span>`}
        <//>
      </div>`)}
    </div>
    <div class="resultado-corpo">
      <div class="escolhas-painel">
        ${r.musica && html`<${Alternar} ligado=${musica} aoMudar=${setMusica} titulo="Baixar a música junto (MP3)"
          ajuda=${[r.musica.autor, r.musica.titulo].filter(Boolean).join(' — ') || 'A música do post'} />`}
        ${r.lives > 0 && html`<${Alternar} ligado=${lives} aoMudar=${setLives} titulo="Baixar o movimento das Live Photos"
          ajuda="Além da foto, o vídeo curto de cada Live Photo." />`}
      </div>
      <div class="resultado-lado">
        <${OndeSalvar} cfg=${cfg} tipo="fotos" escolhas=${{ pasta }} aoMudar=${(p) => setPasta(p.pasta)} resultado=${r} espaco=${espaco} />
        <${BotaoBaixar} fase=${fase} aoClicar=${baixar}>
          Baixar ${plural(r.fotos.length, 'foto', 'fotos')}
        <//>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   Esperando a análise e erros
   ============================================================ */

export function Esqueleto({ url }) {
  return html`<div class="cartao-resultado esqueleto entrar" aria-busy="true">
    <div class="resultado-midia">
      <div class="capa-midia grande brilho"></div>
      <div class="resultado-info">
        <div class="linha-esq brilho" style="width:30%"></div>
        <div class="linha-esq grossa brilho" style="width:85%"></div>
        <div class="linha-esq brilho" style="width:55%"></div>
        <p class="esqueleto-texto"><${Anel} tam="p" /> Lendo o link${url ? html` do <b>${new URL(url).hostname.replace(/^www\./, '')}</b>` : ''}…</p>
      </div>
    </div>
  </div>`;
}

export function ErroAnalise({ erro, aoTentar }) {
  const { sistema } = useLoja();
  const contas = sistema && sistema.contas;
  const site = erro.conta && contas && contas.sites.find((s) => s.id === erro.conta);
  const [detalhe, setDetalhe] = useState(false);
  const conectar = async () => {
    try {
      const r = await api.post(`/contas/${site.id}/entrar`);
      if (r.conectou) { avisar(`Conta do ${site.nome} conectada.`, 'ok'); aoTentar(); }
    } catch (e) { avisar(e.message, 'erro'); }
  };
  return html`<div class="cartao-resultado erro-analise entrar">
    <span class="erro-icone"><${Icone} nome="alerta" tam=${24} /></span>
    <div class="erro-texto">
      <strong>${erro.mensagem}</strong>
      ${erro.detalhe && html`<button class="link" onClick=${() => setDetalhe(!detalhe)}>${detalhe ? 'Esconder detalhes' : 'Ver detalhes'}</button>`}
      ${detalhe && html`<code class="detalhe-tecnico">${erro.detalhe}</code>`}
    </div>
    <div class="erro-acoes">
      ${site && contas.disponivel && html`<button class="btn btn-primario" onClick=${conectar}><${Icone} nome="entrar" tam=${16} /> Conectar ${site.nome}</button>`}
      ${erro.conta && !contas?.disponivel && html`<button class="btn" onClick=${() => ir('/config')}>Configurações</button>`}
      <button class="btn" onClick=${aoTentar}><${Icone} nome="recarregar" tam=${16} /> Tentar de novo</button>
    </div>
  </div>`;
}

