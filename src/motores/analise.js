'use strict';

/**
 * Resume o JSON enorme do yt-dlp no que a tela precisa: título, capa,
 * qualidades disponíveis com o tamanho estimado de cada uma, áudio e,
 * para playlists, a lista de itens.
 */

/** Tamanho em bytes de um formato (exato, aproximado ou pela taxa de bits). */
function tamanhoFormato(f, duracao) {
  if (!f) return null;
  if (f.filesize) return f.filesize;
  if (f.filesize_approx) return f.filesize_approx;
  if (f.tbr && duracao) return Math.round(f.tbr * 125 * duracao); // kbit/s -> bytes
  return null;
}

/** "Resolução" como o yt-dlp entende: a menor dimensão (um vídeo em pé 1080x1920 é 1080p). */
function resolucao(f) {
  if (f.width && f.height) return Math.min(f.width, f.height);
  return f.height || null;
}

const temVideoNo = (f) => f.vcodec !== 'none' && (f.vcodec || f.height || f.width);
const soAudio = (f) => f.vcodec === 'none' && f.acodec && f.acodec !== 'none';
const ehHls = (f) => /^m3u8/.test(f.protocol || '');

/**
 * Ordem de preferência dos codecs, igual à do yt-dlp com as opções do app:
 * MP4 prefere H.264 e, sem ele, o codec "mais próximo" (H.265, VP9, AV1);
 * MKV prefere o melhor (AV1, VP9, H.265, H.264).
 */
function pesoCodec(vcodec, modo) {
  const c = String(vcodec || '').toLowerCase();
  const tipo = /^(av01|av1)/.test(c) ? 'av01' : /^vp0?9/.test(c) ? 'vp9' : /^(hev|hvc|h265)/.test(c) ? 'h265' : /^(avc|h264)/.test(c) ? 'h264' : 'outro';
  const ordem = modo === 'mp4' ? ['h264', 'h265', 'vp9', 'av01', 'outro'] : ['av01', 'vp9', 'h265', 'h264', 'outro'];
  return ordem.indexOf(tipo);
}

/** O formato que o yt-dlp vai escolher numa resolução (para estimar o tamanho certo). */
function escolhido(lista, modo, duracao) {
  // o YouTube também lista versões HLS (de transmissão), que o yt-dlp deixa por último
  const diretos = lista.filter((f) => !ehHls(f));
  const candidatos = diretos.length ? diretos : lista;
  return [...candidatos].sort((a, b) => (pesoCodec(a.vcodec, modo) - pesoCodec(b.vcodec, modo))
    || ((tamanhoFormato(b, duracao) || 0) - (tamanhoFormato(a, duracao) || 0)))[0];
}

/** Miniatura mais próxima da largura pedida (as do YouTube vão de 120 a 1280 px). */
function miniatura(item, largura = 480) {
  const lista = (item.thumbnails || []).filter((t) => t && t.url);
  if (!lista.length) return item.thumbnail || null;
  const comLargura = lista.filter((t) => t.width);
  if (!comLargura.length) return item.thumbnail || lista[lista.length - 1].url;
  const ordenadas = [...comLargura].sort((a, b) => a.width - b.width);
  const boa = ordenadas.find((t) => t.width >= largura);
  return (boa || ordenadas[ordenadas.length - 1]).url;
}

function rotuloQualidade(altura) {
  if (altura >= 4320) return '8K';
  if (altura >= 2160) return '4K';
  if (altura >= 1440) return '2K';
  return `${altura}p`;
}

function detalheQualidade(altura) {
  if (altura >= 4320) return '4320p';
  if (altura >= 2160) return '2160p';
  if (altura >= 1440) return '1440p';
  if (altura >= 1080) return 'Full HD';
  if (altura >= 720) return 'HD';
  return '';
}

const CODECS_AUDIO = { opus: 'Opus', mp4a: 'AAC', aac: 'AAC', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', 'ec-3': 'E-AC-3' };
function nomeCodecAudio(acodec) {
  const base = String(acodec || '').split('.')[0].toLowerCase();
  return CODECS_AUDIO[base] || (base ? base.toUpperCase() : '');
}

/** Chave que identifica o vídeo no histórico: "youtube:dQw4w9WgXcQ". */
function chave(extrator, id) {
  return extrator && id ? `${String(extrator).toLowerCase()}:${id}` : null;
}

/**
 * Um vídeo ou música só.
 * @param {any} info
 */
function resumirMidia(info) {
  const duracao = info.duration || null;
  const formatos = (info.formats && info.formats.length ? info.formats : [info]).filter(Boolean);
  const videos = formatos.filter(temVideoNo).filter((f) => resolucao(f));
  const audios = formatos.filter(soAudio);
  const extensaoVideo = /^(mp4|webm|mkv|mov|m4v|flv|3gp|ts|avi)$/i.test(info.ext || '');
  const temVideo = videos.length > 0 || (formatos.every((f) => !f.vcodec) && extensaoVideo);

  // melhor áudio separado: Opus/qualquer um para MKV, AAC para MP4
  const pesoAudio = (f) => { const i = ['opus', 'vorbis', 'mp4a', 'aac', 'mp3'].findIndex((c) => String(f.acodec || '').startsWith(c)); return i < 0 ? 9 : i; };
  const porTaxa = (a, b) => ((b.abr || b.tbr || 0) - (a.abr || a.tbr || 0)) || (pesoAudio(a) - pesoAudio(b));
  const melhorAudio = [...audios].sort(porTaxa)[0] || null;
  const melhorAac = [...audios].filter((f) => /^mp4a/i.test(f.acodec || '')).sort(porTaxa)[0] || melhorAudio;

  /** @type {Map<number, any[]>} */
  const porAltura = new Map();
  for (const f of videos) {
    const r = resolucao(f);
    if (!porAltura.has(r)) porAltura.set(r, []);
    porAltura.get(r).push(f);
  }
  const qualidades = [...porAltura.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([altura, lista]) => {
      const fps = Math.max(...lista.map((f) => f.fps || 0));
      const maisFluidos = lista.filter((f) => (f.fps || 0) === fps);
      // no MP4 a imagem HDR fica de fora (ela aparece desbotada na maioria das telas)
      const sdr = maisFluidos.filter((f) => !f.dynamic_range || f.dynamic_range === 'SDR');
      const paraMkv = escolhido(maisFluidos, 'mkv', duracao);
      const paraMp4 = escolhido(sdr.length ? sdr : maisFluidos, 'mp4', duracao);
      const somar = (v, a) => {
        const tv = tamanhoFormato(v, duracao);
        if (!tv) return null;
        const temAudioJunto = v.acodec && v.acodec !== 'none';
        return tv + (temAudioJunto ? 0 : (tamanhoFormato(a, duracao) || 0));
      };
      return {
        altura,
        rotulo: rotuloQualidade(altura),
        detalhe: detalheQualidade(altura),
        fps: fps >= 50 ? Math.round(fps) : null,
        hdr: lista.some((f) => f.dynamic_range && f.dynamic_range !== 'SDR'),
        tamanho: { mp4: somar(paraMp4, melhorAac), mkv: somar(paraMkv, melhorAudio) },
      };
    });

  const kbps = (f) => (f ? Math.round(f.abr || f.tbr || 0) || null : null);
  // sem áudio separado (Instagram, TikTok...): o áudio sai do próprio vídeo
  const audioDoVideo = !melhorAudio && formatos.find((f) => f.acodec && f.acodec !== 'none');
  const fonteAudio = melhorAudio || audioDoVideo || null;
  const audio = fonteAudio ? {
    codec: nomeCodecAudio(fonteAudio.acodec),
    kbps: melhorAudio ? kbps(melhorAudio) : null,
    tamanho: melhorAudio ? tamanhoFormato(melhorAudio, duracao) : null,
    tamanhoAac: melhorAac ? tamanhoFormato(melhorAac, duracao) : null,
    codecAac: melhorAac ? nomeCodecAudio(melhorAac.acodec) : null,
  } : null;

  const idiomas = (obj) => Object.keys(obj || {}).filter((l) => /^pt(\b|-|_)/i.test(l));
  return {
    tipo: 'midia',
    url: info.webpage_url || info.original_url || info.url,
    id: info.id,
    chave: chave(info.extractor_key || info.ie_key, info.id),
    titulo: info.title || info.fulltitle || 'Sem título',
    canal: info.channel || info.uploader || info.creator || info.artist || null,
    artista: info.artist || (Array.isArray(info.artists) ? info.artists.join(', ') : null) || null,
    album: info.album || null,
    site: info.extractor_key || info.ie_key || null,
    dominio: info.webpage_url_domain || null,
    miniatura: info.thumbnail || miniatura(info, 640),
    duracao,
    data: info.upload_date || null,
    visualizacoes: info.view_count || null,
    aoVivo: info.is_live === true || info.live_status === 'is_live',
    emBreve: info.live_status === 'is_upcoming',
    temVideo,
    qualidades,
    audio,
    legendas: idiomas(info.subtitles).length > 0 || idiomas(info.automatic_captions).length > 0,
  };
}

/**
 * Lista (playlist, álbum, canal, post com vários vídeos).
 * @param {any} info
 */
function resumirLista(info) {
  const entradas = (info.entries || []).filter(Boolean);
  const itens = entradas.map((e, i) => {
    const ie = e.ie_key || e.extractor_key || info.extractor_key;
    let url = e.webpage_url || e.url || null;
    if (url && !/^https?:/i.test(url) && ie === 'Youtube') url = `https://www.youtube.com/watch?v=${e.id}`;
    const titulo = e.title || e.fulltitle || null;
    return {
      indice: i + 1,
      id: e.id || null,
      chave: chave(ie, e.id),
      url,
      titulo: titulo || `Item ${i + 1}`,
      canal: e.channel || e.uploader || null,
      duracao: e.duration || null,
      miniatura: miniatura(e, 320),
      // o YouTube lista vídeos removidos ou privados com estes nomes
      indisponivel: !url || /^\[(private|deleted|unavailable)/i.test(titulo || ''),
    };
  });
  return {
    tipo: 'lista',
    url: info.webpage_url || info.original_url,
    id: info.id,
    titulo: info.title || 'Playlist',
    canal: info.channel || info.uploader || null,
    site: info.extractor_key || null,
    miniatura: miniatura(info, 640) || (itens.find((i) => i.miniatura) || {}).miniatura || null,
    quantidade: itens.length,
    duracaoTotal: itens.reduce((s, i) => s + (i.duracao || 0), 0) || null,
    itens,
  };
}

/** @param {any} info */
function resumir(info) {
  if (info && (info._type === 'playlist' || info._type === 'multi_video' || Array.isArray(info.entries))) {
    const lista = resumirLista(info);
    // post com um vídeo só (comum no Instagram e no X): vira item normal
    if (lista.quantidade === 1 && info.entries[0] && (info.entries[0].formats || info.entries[0].url)) {
      const unico = info.entries[0];
      if (unico.formats) return resumirMidia({ ...unico, webpage_url: unico.webpage_url || info.webpage_url });
    }
    return lista;
  }
  return resumirMidia(info);
}

module.exports = { resumir, resumirMidia, resumirLista, rotuloQualidade, tamanhoFormato, chave };
