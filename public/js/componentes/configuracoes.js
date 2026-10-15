import { html, useState, cx, tamanho, caminhoCurto, dataRelativa } from '../lib.js';
import { Icone } from '../icones.js';
import { api, avisar, useLoja, salvarConfig, escolherPasta } from '../loja.js';
import { Alternar, Segmentado, Credito, Anel, Logo } from './base.js';
import { abrirPasta } from './lateral.js';

function Pasta({ rotulo, icone, cor, chave, qual, cfg, espaco }) {
  const trocar = async () => {
    try {
      const r = await escolherPasta(cfg[chave]);
      if (r) { await salvarConfig({ [chave]: r.pasta }); avisar(`Pasta de ${rotulo.toLowerCase()} trocada.`, 'ok'); }
    } catch (e) { avisar(e.message, 'erro'); }
  };
  return html`<div class="linha-pasta">
    <span class="nav-icone" style=${`--cor:${cor}`}><${Icone} nome=${icone} tam=${16} /></span>
    <div class="linha-pasta-texto">
      <strong>${rotulo}</strong>
      <small title=${cfg[chave]}>${caminhoCurto(cfg[chave], 4)}${espaco != null ? ` · ${tamanho(espaco)} livres` : ''}</small>
    </div>
    <button class="btn btn-p btn-fantasma" onClick=${() => abrirPasta(qual)}><${Icone} nome="externo" tam=${14} /> Abrir</button>
    <button class="btn btn-p" onClick=${trocar}>Trocar</button>
  </div>`;
}

const EXEMPLO_VIDEOS = {
  canal: 'Vídeos › Nome do canal › Título.mp4',
  site: 'Vídeos › YouTube › Nome do canal › Título.mp4',
  data: 'Vídeos › 2026-10 › Título.mp4',
  nenhuma: 'Vídeos › Título.mp4',
};
const EXEMPLO_MUSICAS = {
  'artista-album': 'Músicas › Artista › Álbum › Música.m4a',
  artista: 'Músicas › Artista › Música.m4a',
  nenhuma: 'Músicas › Música.m4a',
};

function Componentes({ c }) {
  const [verificando, setVerificando] = useState(false);
  const atualizar = async () => {
    setVerificando(true);
    try {
      const r = await api.post('/componentes/atualizar');
      avisar(r.atualizado ? `yt-dlp atualizado para ${r.versao}.` : 'O yt-dlp já está na versão mais nova.', 'ok');
    } catch (e) { avisar(e.message, 'erro'); } finally { setVerificando(false); }
  };
  const reinstalar = () => api.post('/componentes/instalar').catch((e) => avisar(e.message, 'erro'));
  return html`<div class="painel config-cartao">
    <h3>Componentes</h3>
    <p class="ajuda">Os dois programas que fazem o trabalho pesado. O yt-dlp se atualiza sozinho porque os sites mudam o tempo todo.</p>
    <div class="capacidade">
      <span class=${cx('ponto-estado', c.ytdlp.ok ? 'ok' : 'nao')}></span>
      <div class="texto">yt-dlp <small>${c.ytdlp.ok ? `Versão ${c.ytdlp.versao}${c.ytdlp.proprio ? '' : ' (instalado no computador)'}` : 'Não instalado'}${c.ultimaVerificacao ? ` · verificado ${dataRelativa(c.ultimaVerificacao)}` : ''}</small></div>
      ${c.ytdlp.ok && c.ytdlp.proprio && html`<button class="btn btn-p" onClick=${atualizar} disabled=${verificando || c.instalando}>
        ${verificando ? html`<${Anel} tam="p" />` : html`<${Icone} nome="recarregar" tam=${14} />`} Procurar atualização
      </button>`}
    </div>
    <div class="capacidade">
      <span class=${cx('ponto-estado', c.ffmpeg.ok ? 'ok' : 'nao')}></span>
      <div class="texto">FFmpeg <small>${c.ffmpeg.ok ? `Versão ${c.ffmpeg.versao}${c.ffmpeg.proprio ? '' : ' (instalado no computador)'}` : 'Não instalado'}</small></div>
    </div>
    <div class="capacidade">
      <span class="ponto-estado ok"></span>
      <div class="texto">Motor JavaScript <small>Node ${c.motorJs.versao} (o YouTube exige um)</small></div>
    </div>
    ${c.instalando && html`<div class="instalando-mini"><${Anel} tam="p" /> ${c.instalando.etapa}${c.instalando.total ? ` · ${Math.floor((c.instalando.baixado / c.instalando.total) * 100)}%` : ''}</div>`}
    ${c.erro && html`<div class="alerta erro"><${Icone} nome="erro" tam=${17} /><div>${c.erro} <button class="link" onClick=${reinstalar}>Tentar de novo</button></div></div>`}
  </div>`;
}

function Contas({ contas }) {
  const [ocupado, setOcupado] = useState(null);
  const agir = async (id, acao) => {
    setOcupado(id);
    try {
      const r = await api.post(`/contas/${id}/${acao}`);
      const site = contas.sites.find((s) => s.id === id);
      if (acao === 'entrar' && r.conectou) avisar(`Conta do ${site.nome} conectada.`, 'ok');
      if (acao === 'sair') avisar(`Conta do ${site.nome} desconectada.`, 'ok');
    } catch (e) { avisar(e.message, 'erro'); } finally { setOcupado(null); }
  };
  return html`<div class="painel config-cartao">
    <h3>Contas conectadas</h3>
    <p class="ajuda">Instagram, Facebook, X e outros escondem muitos vídeos de quem não está logado. Entre uma vez na sua conta numa janela do próprio SalvaTudo e esses downloads passam a funcionar. A senha vai direto para o site; nada sai deste computador.</p>
    <div class="grade-contas">
      ${contas.sites.map((s) => html`<div class=${cx('conta', s.conectado && 'conectada')} key=${s.id} style=${`--cor-site:${s.cor}`}>
        <span class="conta-logo"><${Logo} id=${s.id} tam=${18} /></span>
        <div class="conta-texto"><strong>${s.nome}</strong><small>${s.conectado ? 'Conectada' : 'Não conectada'}</small></div>
        <button class=${cx('btn btn-p', s.conectado ? 'btn-fantasma' : '')} disabled=${ocupado === s.id} onClick=${() => agir(s.id, s.conectado ? 'sair' : 'entrar')}>
          ${ocupado === s.id ? html`<${Anel} tam="p" />` : s.conectado ? 'Sair' : 'Entrar'}
        </button>
      </div>`)}
    </div>
  </div>`;
}

function LoginNavegador({ cfg, salvar }) {
  return html`<div class="painel config-cartao">
    <h3>Usar o login do navegador</h3>
    <p class="ajuda">Para vídeos que pedem login (Instagram, idade restrita no YouTube...). O SalvaTudo usa a sessão do navegador escolhido. No Chrome e no Edge, feche o navegador antes de baixar; o Firefox funciona aberto.</p>
    <select class="entrada" value=${cfg.loginNavegador} onChange=${(e) => salvar({ loginNavegador: e.currentTarget.value })}>
      <option value="">Não usar</option>
      <option value="firefox">Firefox</option>
      <option value="chrome">Google Chrome</option>
      <option value="edge">Microsoft Edge</option>
      <option value="brave">Brave</option>
      <option value="opera">Opera</option>
      <option value="vivaldi">Vivaldi</option>
    </select>
  </div>`;
}

export function Configuracoes() {
  const { sistema } = useLoja();
  if (!sistema) return html`<div class="pagina"><div class="vazio-estado"><${Anel} /></div></div>`;
  const cfg = sistema.config;
  const espaco = sistema.espaco || {};
  const salvar = (parcial) => salvarConfig(parcial).catch((e) => avisar(e.message, 'erro'));

  return html`<div class="pagina">
    <div class="pagina-topo">
      <div><h1>Configurações</h1><p>Onde salvar, como organizar e como baixar.</p></div>
    </div>

    <div class="config-grade">
      <div class="painel config-cartao">
        <h3>Onde salvar</h3>
        <${Pasta} rotulo="Vídeos" icone="video" cor="#6246ea" chave="pastaVideos" qual="videos" cfg=${cfg} espaco=${espaco.videos} />
        <${Pasta} rotulo="Músicas" icone="musica" cor="#e0457b" chave="pastaMusicas" qual="musicas" cfg=${cfg} espaco=${espaco.musicas} />
        <${Pasta} rotulo="Fotos" icone="imagem" cor="#0f9f8f" chave="pastaFotos" qual="fotos" cfg=${cfg} espaco=${espaco.fotos} />
      </div>

      <div class="painel config-cartao">
        <h3>Organização</h3>
        <div class="campo">
          <div class="rotulo-campo">Vídeos</div>
          <${Segmentado} rotulo="Organizar vídeos" valor=${cfg.organizarVideos} aoMudar=${(v) => salvar({ organizarVideos: v })} opcoes=${[
            { valor: 'canal', rotulo: 'Por canal' }, { valor: 'site', rotulo: 'Por site' }, { valor: 'data', rotulo: 'Por mês' }, { valor: 'nenhuma', rotulo: 'Tudo junto' },
          ]} />
          <p class="exemplo-caminho"><${Icone} nome="pasta" tam=${13} /> ${EXEMPLO_VIDEOS[cfg.organizarVideos]}</p>
        </div>
        <div class="campo">
          <div class="rotulo-campo">Músicas</div>
          <${Segmentado} rotulo="Organizar músicas" valor=${cfg.organizarMusicas} aoMudar=${(v) => salvar({ organizarMusicas: v })} opcoes=${[
            { valor: 'artista-album', rotulo: 'Artista e álbum' }, { valor: 'artista', rotulo: 'Por artista' }, { valor: 'nenhuma', rotulo: 'Tudo junto' },
          ]} />
          <p class="exemplo-caminho"><${Icone} nome="pasta" tam=${13} /> ${EXEMPLO_MUSICAS[cfg.organizarMusicas]}</p>
        </div>
        <${Alternar} ligado=${cfg.numerarPlaylist} aoMudar=${(v) => salvar({ numerarPlaylist: v })}
          titulo="Numerar os itens de playlists" ajuda="01 - Primeira, 02 - Segunda… na ordem da playlist." />
        <${Alternar} ligado=${cfg.capaQuadrada} aoMudar=${(v) => salvar({ capaQuadrada: v })}
          titulo="Capa quadrada nas músicas" ajuda="Recorta a capa do vídeo no formato de capa de álbum." />
      </div>

      <div class="painel config-cartao">
        <h3>Downloads</h3>
        <div class="campo">
          <div class="rotulo-campo">Ao mesmo tempo</div>
          <${Segmentado} rotulo="Downloads ao mesmo tempo" valor=${cfg.simultaneos} aoMudar=${(v) => salvar({ simultaneos: v })}
            opcoes=${[1, 2, 3, 4, 5].map((n) => ({ valor: n, rotulo: String(n) }))} />
        </div>
        <div class="campo">
          <div class="rotulo-campo">Limite de velocidade</div>
          <${Segmentado} rotulo="Limite de velocidade" valor=${cfg.limiteVelocidade} aoMudar=${(v) => salvar({ limiteVelocidade: v })}
            opcoes=${[{ valor: 0, rotulo: 'Sem limite' }, { valor: 1, rotulo: '1 MB/s' }, { valor: 3, rotulo: '3 MB/s' }, { valor: 10, rotulo: '10 MB/s' }]} />
          <p class="ajuda">Para não travar a internet da casa enquanto baixa.</p>
        </div>
        <${Alternar} ligado=${cfg.vigiarAreaTransferencia} aoMudar=${(v) => salvar({ vigiarAreaTransferencia: v })}
          titulo="Oferecer o link copiado" ajuda="Copiou um link e voltou para o SalvaTudo? Ele aparece pronto para baixar." />
        <${Alternar} ligado=${cfg.notificar} aoMudar=${(v) => salvar({ notificar: v })}
          titulo="Avisar quando terminar" ajuda="Notificação do Windows quando a fila acabar." />
        <${Alternar} ligado=${cfg.abrirPastaAoTerminar} aoMudar=${(v) => salvar({ abrirPastaAoTerminar: v })}
          titulo="Abrir a pasta quando terminar" ajuda="Mostra o arquivo no Explorer quando a fila acabar." />
        <${Alternar} ligado=${cfg.fotosMusica} aoMudar=${(v) => salvar({ fotosMusica: v })}
          titulo="Fotos do TikTok: baixar a música junto" />
      </div>

      ${sistema.contas && sistema.contas.disponivel
        ? html`<${Contas} contas=${sistema.contas} />`
        : html`<${LoginNavegador} cfg=${cfg} salvar=${salvar} />`}

      <${Componentes} c=${sistema.componentes} />
      <div class="painel config-cartao">
        <${Alternar} ligado=${cfg.atualizarAuto} aoMudar=${(v) => salvar({ atualizarAuto: v })}
          titulo="Atualizar o yt-dlp sozinho" ajuda="Procura versão nova uma vez por dia. Recomendado: os sites mudam o tempo todo." />
      </div>

      <div class="painel config-cartao sobre">
        <img src="/icones/salvatudo.svg" alt="" width="48" height="48" />
        <div>
          <h3>SalvaTudo ${sistema.versao}</h3>
          <p class="ajuda">Feito com yt-dlp, FFmpeg, Preact e Electron. Código aberto (licença MIT).</p>
          <p class="ajuda">Baixe só o que você tem direito: conteúdo seu, livre ou com permissão de quem fez.</p>
          <${Credito} classe="credito-cartao" />
        </div>
      </div>
    </div>
  </div>`;
}
