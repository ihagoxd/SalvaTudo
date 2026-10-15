'use strict';

/**
 * A "cara de app" sem o Electron: abre o SalvaTudo numa janela própria do
 * Edge/Chrome, sem barra de endereço nem abas. Quando a janela fecha e não há
 * download em andamento, o servidor encerra sozinho (só no modo app).
 */

const { spawn, execFile } = require('child_process');
const config = require('../config');
const so = require('../motores/so');

async function jaRodando(url) {
  try {
    const r = await fetch(`${url}/api/sistema`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const d = await r.json();
    return Boolean(d && d.versao);
  } catch (_) {
    return false;
  }
}

function abrirNoNavegadorPadrao(url) {
  if (so.EH_WINDOWS) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], () => {});
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

/**
 * @param {string} url
 * @param {{modoApp?: boolean}} [opcoes]
 */
async function abrir(url, { modoApp = config.MODO_APP } = {}) {
  const navegador = so.acharNavegador();
  if (!modoApp || !navegador) {
    abrirNoNavegadorPadrao(url);
    return;
  }
  const args = [
    `--app=${url}`,
    // perfil próprio: a janela do SalvaTudo não se mistura com o navegador da pessoa
    `--user-data-dir=${config.pastas.navegador}`,
    '--window-size=1280,860',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,msEdgeSidebarV2,msHubApps,msEdgeShopping',
    '--disable-sync',
  ];
  try {
    const p = spawn(navegador, args, { detached: true, stdio: 'ignore', windowsHide: false });
    p.on('error', () => abrirNoNavegadorPadrao(url));
    p.unref();
  } catch (_) {
    abrirNoNavegadorPadrao(url);
  }
}

/**
 * Encerra o servidor quando não houver mais nenhuma janela conectada e nenhum
 * download em andamento. Espera um pouco: recarregar a página derruba e refaz a conexão.
 * @param {{quantos: () => number, aoMudarClientes: (fn: (n: number) => void) => void}} eventos
 * @param {() => boolean} ocupado
 */
function encerrarQuandoFechar(eventos, ocupado) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const ESPERA_FECHOU = 15000;
  const ESPERA_INICIO = 120000;

  const agendar = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (eventos.quantos() > 0) return;
      // janela fechada com download em andamento: termina primeiro
      if (ocupado()) { agendar(30000); return; }
      console.log('  Janela fechada. Encerrando o SalvaTudo.');
      process.exit(0);
    }, ms);
  };

  agendar(ESPERA_INICIO); // se a janela nunca chegar a abrir
  eventos.aoMudarClientes((n) => {
    if (n === 0) agendar(ESPERA_FECHOU);
    else clearTimeout(timer);
  });
}

module.exports = { jaRodando, abrir, encerrarQuandoFechar };
