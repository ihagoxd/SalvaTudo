// Sites mais usados: nome e cor para reconhecer o link colado.
// O SalvaTudo funciona com mais de 1.700 sites; estes só ganham destaque.

export const SITES = [
  { id: 'youtube', nome: 'YouTube', cor: '#ff0033', hosts: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] },
  { id: 'instagram', nome: 'Instagram', cor: '#e1306c', hosts: ['instagram.com'] },
  { id: 'tiktok', nome: 'TikTok', cor: '#fe2c55', hosts: ['tiktok.com'] },
  { id: 'facebook', nome: 'Facebook', cor: '#1877f2', hosts: ['facebook.com', 'fb.watch', 'fb.com'] },
  { id: 'x', nome: 'X (Twitter)', cor: '#64748b', hosts: ['x.com', 'twitter.com'] },
  { id: 'pinterest', nome: 'Pinterest', cor: '#e60023', hosts: ['pinterest.com', 'pin.it'] },
  { id: 'soundcloud', nome: 'SoundCloud', cor: '#ff5500', hosts: ['soundcloud.com'] },
  { id: 'twitch', nome: 'Twitch', cor: '#9146ff', hosts: ['twitch.tv'] },
  { id: 'kick', nome: 'Kick', cor: '#20b04b', hosts: ['kick.com'] },
  { id: 'vimeo', nome: 'Vimeo', cor: '#17a9d6', hosts: ['vimeo.com'] },
  { id: 'reddit', nome: 'Reddit', cor: '#ff4500', hosts: ['reddit.com', 'redd.it'] },
  { id: 'dailymotion', nome: 'Dailymotion', cor: '#0a6cff', hosts: ['dailymotion.com', 'dai.ly'] },
  { id: 'bluesky', nome: 'Bluesky', cor: '#1185fe', hosts: ['bsky.app'] },
  { id: 'linkedin', nome: 'LinkedIn', cor: '#0a66c2', hosts: ['linkedin.com'] },
  { id: 'globo', nome: 'Globo', cor: '#f15a22', hosts: ['globo.com', 'g1.globo.com', 'ge.globo.com'] },
  { id: 'bandcamp', nome: 'Bandcamp', cor: '#1da0c3', hosts: ['bandcamp.com'] },
];

/** Os que aparecem em destaque na tela inicial. */
export const DESTAQUES = ['youtube', 'instagram', 'tiktok', 'facebook', 'x', 'pinterest', 'soundcloud', 'twitch', 'kick', 'vimeo', 'reddit']
  .map((id) => SITES.find((s) => s.id === id));

/** Site de um link (ou de um extrator do yt-dlp: "Youtube", "TikTok", "twitter"...). */
export function siteDe(urlOuExtrator) {
  const texto = String(urlOuExtrator || '');
  let host = '';
  try { host = new URL(texto).hostname.toLowerCase(); } catch (_) { /* é nome de extrator */ }
  if (host) {
    return SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`))) || null;
  }
  const e = texto.toLowerCase();
  if (e.startsWith('twitter')) return SITES.find((s) => s.id === 'x');
  return SITES.find((s) => e.startsWith(s.id)) || null;
}

/** Nome bonito para qualquer link: o site conhecido ou o domínio. */
export function nomeDoSite(urlOuExtrator) {
  const s = siteDe(urlOuExtrator);
  if (s) return s.nome;
  try { return new URL(urlOuExtrator).hostname.replace(/^www\./, ''); } catch (_) { return urlOuExtrator || ''; }
}
