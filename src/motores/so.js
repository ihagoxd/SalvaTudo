'use strict';

/**
 * Conversa com o sistema operacional: achar programas, abrir pastas e
 * arquivos, escolher pasta, ler a área de transferência e encerrar processos.
 * Dentro do app (Electron) usa as janelas nativas; rodando com o Node puro,
 * usa o PowerShell.
 */

const fs = require('fs');
const path = require('path');
const { execFile, spawn, spawnSync } = require('child_process');

const EH_WINDOWS = process.platform === 'win32';
const NO_ELECTRON = Boolean(process.versions.electron);

/** API do Electron quando o servidor roda dentro do app; senão, null. */
function electron() {
  if (!NO_ELECTRON) return null;
  try { return require('electron'); } catch (_) { return null; }
}

function existe(c) {
  try { return fs.existsSync(c); } catch (_) { return false; }
}

/**
 * Procura um executável numa lista de lugares conhecidos e depois no PATH.
 * @param {string | string[]} nomes
 * @param {string[]} [candidatos]
 * @returns {string | null}
 */
function acharPrograma(nomes, candidatos = []) {
  for (const c of candidatos) if (existe(c)) return c;
  const lista = Array.isArray(nomes) ? nomes : [nomes];
  const caminhos = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensoes = EH_WINDOWS ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const nome of lista) {
    for (const dir of caminhos) {
      for (const ext of extensoes) {
        const alvo = path.join(dir, nome + ext);
        if (existe(alvo)) return alvo;
      }
    }
  }
  return null;
}

const PF = process.env.ProgramFiles || 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
const LOCAL = process.env.LOCALAPPDATA || '';

/** @type {string | null | undefined} */
let navegadorCache;

/** Edge primeiro no Windows: está em toda máquina com Windows 10/11. */
function acharNavegador() {
  if (navegadorCache === undefined) {
    navegadorCache = acharPrograma(
      EH_WINDOWS ? ['msedge', 'chrome'] : ['chromium', 'chromium-browser', 'google-chrome', 'microsoft-edge'],
      EH_WINDOWS
        ? [
          path.join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(PF, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(PF, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          LOCAL && path.join(LOCAL, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ].filter(Boolean)
        : [],
    );
  }
  return navegadorCache;
}

/* ---------------- abrir arquivos, pastas e links ---------------- */

/** Abre o Explorer com o arquivo selecionado (ou a pasta). */
function mostrarNaPasta(caminho) {
  return new Promise((resolve) => {
    const alvo = path.resolve(caminho);
    const el = electron();
    if (el && el.shell) {
      if (existe(alvo) && fs.statSync(alvo).isFile()) el.shell.showItemInFolder(alvo);
      else el.shell.openPath(alvo);
      resolve(true);
      return;
    }
    if (EH_WINDOWS) {
      const args = existe(alvo) && fs.statSync(alvo).isFile() ? [`/select,${alvo}`] : [alvo];
      // o explorer devolve código 1 mesmo quando dá certo
      execFile('explorer.exe', args, { windowsHide: false }, () => resolve(true));
    } else {
      const p = spawn('xdg-open', [existe(alvo) && fs.statSync(alvo).isFile() ? path.dirname(alvo) : alvo], { detached: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.unref();
      resolve(true);
    }
  });
}

/** Abre o arquivo no programa padrão (player de vídeo, de música...). */
function abrirArquivo(caminho) {
  return new Promise((resolve) => {
    const alvo = path.resolve(caminho);
    const el = electron();
    if (el && el.shell) {
      el.shell.openPath(alvo).then((erro) => resolve(!erro));
      return;
    }
    if (EH_WINDOWS) {
      // explorer abre com o programa padrão sem passar pelo cmd (que se
      // confunde com & e ^ no nome do arquivo)
      execFile('explorer.exe', [alvo], { windowsHide: false }, () => resolve(true));
    } else {
      const p = spawn('xdg-open', [alvo], { detached: true, stdio: 'ignore' });
      p.on('error', () => resolve(false));
      p.unref();
      resolve(true);
    }
  });
}

/** Abre um link no navegador de sempre da pessoa. */
function abrirLink(url) {
  if (!/^https:\/\//i.test(url)) return;
  const el = electron();
  if (el && el.shell) { el.shell.openExternal(url); return; }
  if (EH_WINDOWS) execFile('rundll32.exe', ['url.dll,FileProtocolHandler', url], () => {});
  else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
}

/* ---------------- PowerShell (fora do Electron) ---------------- */

/**
 * Roda um script curto no PowerShell e devolve o que ele escreveu (UTF-8).
 * @param {string} script
 * @param {Record<string, string>} [env]
 * @returns {Promise<string>}
 */
function powershell(script, env = {}) {
  return new Promise((resolve, reject) => {
    const completo = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`;
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', completo], {
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      timeout: 10 * 60 * 1000,
      maxBuffer: 4 * 1024 * 1024,
    }, (err, saida) => (err ? reject(err) : resolve(String(saida || '').replace(/\r?\n$/, ''))));
  });
}

/**
 * Janela do Windows para escolher uma pasta.
 * @param {string} [inicial]
 * @returns {Promise<string | null>} null quando a pessoa cancela
 */
async function escolherPasta(inicial) {
  const el = electron();
  if (el && el.dialog) {
    const dono = el.BrowserWindow.getFocusedWindow() || el.BrowserWindow.getAllWindows()[0];
    const opcoes = {
      title: 'Escolha onde salvar',
      buttonLabel: 'Usar esta pasta',
      defaultPath: inicial && existe(inicial) ? inicial : undefined,
      properties: /** @type {Array<'openDirectory' | 'createDirectory' | 'promptToCreate'>} */ (['openDirectory', 'createDirectory', 'promptToCreate']),
    };
    const r = dono ? await el.dialog.showOpenDialog(dono, opcoes) : await el.dialog.showOpenDialog(opcoes);
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  }
  if (!EH_WINDOWS) return null;
  // Janela "sempre na frente" como dona: sem ela a caixa abre atrás do navegador.
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dono = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; Opacity = 0 }
$dono.Show(); $dono.Activate()
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Escolha onde salvar'
$d.ShowNewFolderButton = $true
if ($env:MB_INICIAL -and (Test-Path -LiteralPath $env:MB_INICIAL)) { $d.SelectedPath = $env:MB_INICIAL }
if ($d.ShowDialog($dono) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
$dono.Close()`;
  const r = await powershell(script, { MB_INICIAL: inicial || '' });
  return r.trim() || null;
}

/** Texto copiado (Ctrl+C) agora há pouco. */
async function lerAreaTransferencia() {
  const el = electron();
  if (el && el.clipboard) return el.clipboard.readText() || '';
  if (!EH_WINDOWS) return '';
  try { return await powershell('Get-Clipboard -Raw'); } catch (_) { return ''; }
}

/**
 * Aviso do Windows no canto da tela (só no app).
 * @param {string} titulo
 * @param {string} corpo
 * @param {() => void} [aoClicar]
 */
function notificar(titulo, corpo, aoClicar) {
  const el = electron();
  if (!el || !el.Notification || !el.Notification.isSupported()) return;
  const aviso = new el.Notification({ title: titulo, body: corpo, silent: false });
  if (aoClicar) aviso.on('click', aoClicar);
  aviso.show();
}

/* ---------------- processos e disco ---------------- */

/**
 * Encerra o processo e tudo o que ele abriu (o yt-dlp abre o FFmpeg).
 * Síncrono de propósito: precisa funcionar até no evento "exit".
 * @param {number | undefined} pid
 */
function encerrarArvore(pid) {
  if (!pid) return;
  if (EH_WINDOWS) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch (_) {
      try { process.kill(pid, 'SIGKILL'); } catch (__) { /* já saiu */ }
    }
  }
}

/** Espaço livre (bytes) no disco da pasta, ou null se não der para saber. */
function espacoLivre(pasta) {
  let alvo = path.resolve(pasta);
  while (!existe(alvo)) {
    const pai = path.dirname(alvo);
    if (pai === alvo) return null;
    alvo = pai;
  }
  try {
    const s = fs.statfsSync(alvo);
    return s.bavail * s.bsize;
  } catch (_) {
    return null;
  }
}

module.exports = {
  EH_WINDOWS,
  NO_ELECTRON,
  acharPrograma,
  acharNavegador,
  mostrarNaPasta,
  abrirArquivo,
  abrirLink,
  escolherPasta,
  lerAreaTransferencia,
  notificar,
  encerrarArvore,
  espacoLivre,
};
