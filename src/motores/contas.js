'use strict';

/**
 * Contas conectadas: Instagram, Facebook, X e outros escondem muitos vídeos
 * de quem não está logado. No app, a pessoa entra na conta numa janela do
 * próprio SalvaTudo (uma vez só) e os cookies dessa janela vão para o
 * yt-dlp num arquivo temporário a cada download.
 *
 * Mais confiável que ler os cookies do Chrome, que o Windows protege e o
 * navegador tranca enquanto está aberto. Tudo fica só neste computador.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('../config');
const so = require('./so');
const { gerarId } = require('../nucleo/util');

const PARTICAO = 'persist:contas';

/**
 * @typedef {object} Site
 * @property {string} id
 * @property {string} nome
 * @property {string} cor
 * @property {string} entrar         página de login
 * @property {string[]} dominios     de quem são os cookies
 * @property {string} cookie         cookie que só existe com a conta conectada
 */

/** @type {Site[]} */
const SITES = [
  { id: 'instagram', nome: 'Instagram', cor: '#e1306c', entrar: 'https://www.instagram.com/accounts/login/', dominios: ['instagram.com'], cookie: 'sessionid' },
  { id: 'facebook', nome: 'Facebook', cor: '#1877f2', entrar: 'https://www.facebook.com/login/', dominios: ['facebook.com'], cookie: 'c_user' },
  { id: 'x', nome: 'X (Twitter)', cor: '#71767b', entrar: 'https://x.com/i/flow/login', dominios: ['x.com', 'twitter.com'], cookie: 'auth_token' },
  { id: 'tiktok', nome: 'TikTok', cor: '#fe2c55', entrar: 'https://www.tiktok.com/login', dominios: ['tiktok.com'], cookie: 'sessionid' },
  { id: 'reddit', nome: 'Reddit', cor: '#ff4500', entrar: 'https://www.reddit.com/login/', dominios: ['reddit.com'], cookie: 'reddit_session' },
  { id: 'vimeo', nome: 'Vimeo', cor: '#17d5ff', entrar: 'https://vimeo.com/log_in', dominios: ['vimeo.com'], cookie: 'vimeo' },
  { id: 'twitch', nome: 'Twitch', cor: '#9146ff', entrar: 'https://www.twitch.tv/login', dominios: ['twitch.tv'], cookie: 'auth-token' },
];

/** Qual site de login cuida deste extrator do yt-dlp ("Instagram", "twitter"...). */
function sitePorExtrator(extrator) {
  const e = String(extrator || '').toLowerCase();
  if (e.startsWith('twitter')) return 'x';
  return (SITES.find((s) => e.startsWith(s.id)) || {}).id || null;
}

function electron() {
  if (!so.NO_ELECTRON) return null;
  try { return require('electron'); } catch (_) { return null; }
}

const disponivel = () => Boolean(electron());

function sessao() {
  const el = electron();
  return el ? el.session.fromPartition(PARTICAO) : null;
}

const doDominio = (cookie, dominios) => {
  const d = String(cookie.domain || '').replace(/^\./, '').toLowerCase();
  return dominios.some((alvo) => d === alvo || d.endsWith(`.${alvo}`));
};

/** Quais contas estão conectadas agora. */
async function estado() {
  const s = sessao();
  if (!s) return { disponivel: false, sites: SITES.map((x) => ({ ...x, conectado: false })) };
  const cookies = await s.cookies.get({});
  const agora = Date.now() / 1000;
  return {
    disponivel: true,
    sites: SITES.map((site) => ({
      ...site,
      conectado: cookies.some((c) => c.name === site.cookie && doDominio(c, site.dominios)
        && c.value && (!c.expirationDate || c.expirationDate > agora)),
    })),
  };
}

/** Navegador comum, sem "Electron" no nome: alguns sites recusam login de apps. */
function agenteComum(el) {
  return el.session.defaultSession.getUserAgent()
    .replace(/\s*Electron\/\S+/i, '')
    .replace(/\s*salvatudo\/\S+/i, '');
}

/** @type {any} */
let janelaAberta = null;

/**
 * Abre a página de login do site. Termina quando a pessoa fecha a janela
 * (ou sozinha, logo depois que a conta conectar).
 * @param {string} id
 * @returns {Promise<boolean>} conectou?
 */
async function entrar(id) {
  const el = electron();
  const site = SITES.find((s) => s.id === id);
  if (!el || !site) return false;
  if (janelaAberta && !janelaAberta.isDestroyed()) { janelaAberta.focus(); return false; }

  const dono = el.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w !== janelaAberta) || null;
  const janela = new el.BrowserWindow({
    width: 520,
    height: 760,
    parent: dono || undefined,
    title: `Entrar no ${site.nome} — SalvaTudo`,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: { partition: PARTICAO, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  janelaAberta = janela;
  janela.webContents.setUserAgent(agenteComum(el));
  // pop-ups de login (ex.: "Entrar com o Google") abrem como janelas filhas da mesma sessão
  janela.webContents.setWindowOpenHandler(() => ({
    action: 'allow',
    overrideBrowserWindowOptions: { parent: janela, autoHideMenuBar: true, webPreferences: { partition: PARTICAO } },
  }));

  let conectou = false;
  const conferir = async () => {
    if (conectou || janela.isDestroyed()) return;
    const cookies = await sessao().cookies.get({ name: site.cookie });
    if (cookies.some((c) => doDominio(c, site.dominios) && c.value)) {
      conectou = true;
      // dá um instante para o site terminar de gravar o resto dos cookies
      setTimeout(() => { if (!janela.isDestroyed()) janela.close(); }, 1500);
    }
  };
  const timer = setInterval(conferir, 1000);
  janela.webContents.on('did-navigate', conferir);
  janela.webContents.on('did-navigate-in-page', conferir);

  await janela.loadURL(site.entrar).catch(() => {});
  await new Promise((ok) => janela.once('closed', () => ok(undefined)));
  clearInterval(timer);
  janelaAberta = null;
  if (dono && !dono.isDestroyed()) dono.focus();
  return conectou;
}

/** Desconecta: apaga os cookies daquele site. */
async function sair(id) {
  const s = sessao();
  const site = SITES.find((x) => x.id === id);
  if (!s || !site) return;
  for (const c of await s.cookies.get({})) {
    if (!doDominio(c, site.dominios)) continue;
    const host = String(c.domain).replace(/^\./, '');
    await s.cookies.remove(`http${c.secure ? 's' : ''}://${host}${c.path || '/'}`, c.name).catch(() => {});
  }
  await s.cookies.flushStore();
}

/**
 * Grava os cookies no formato que o yt-dlp lê (Netscape). Um arquivo por
 * download, porque o yt-dlp regrava o arquivo ao terminar.
 * @returns {Promise<string | null>} caminho do arquivo, ou null se não há conta conectada
 */
async function exportar() {
  const s = sessao();
  if (!s) return null;
  const cookies = (await s.cookies.get({})).filter((c) => SITES.some((site) => doDominio(c, site.dominios)));
  if (!cookies.length) return null;
  const linhas = ['# Netscape HTTP Cookie File', '# Gerado pelo SalvaTudo. Apagado ao fim do download.', ''];
  for (const c of cookies) {
    const subdominios = !c.hostOnly && String(c.domain).startsWith('.');
    const dominio = c.hostOnly ? String(c.domain).replace(/^\./, '') : String(c.domain);
    linhas.push([
      (c.httpOnly ? '#HttpOnly_' : '') + dominio,
      subdominios ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      String(Math.round(c.expirationDate || 0)),
      c.name,
      c.value,
    ].join('\t'));
  }
  const pasta = path.join(config.pastas.temp, 'cookies');
  await fsp.mkdir(pasta, { recursive: true });
  const arquivo = path.join(pasta, `${gerarId()}.txt`);
  await fsp.writeFile(arquivo, `${linhas.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  return arquivo;
}

function apagarExportado(arquivo) {
  if (arquivo) fs.rm(arquivo, { force: true }, () => {});
}

module.exports = { SITES, disponivel, estado, entrar, sair, exportar, apagarExportado, sitePorExtrator };
