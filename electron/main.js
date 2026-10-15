'use strict';

/**
 * SalvaTudo como aplicativo de Windows (Electron).
 *
 * O mesmo servidor roda aqui dentro, sem precisar do Node.js instalado, e a
 * interface abre numa janela própria. Os dados (configurações, histórico e
 * os componentes yt-dlp/FFmpeg) ficam em %APPDATA%\SalvaTudo\dados.
 *
 * Extras do app: progresso na barra de tarefas, aviso do Windows ao
 * terminar, o computador não dorme no meio de um download e uma pergunta
 * antes de fechar com download andando.
 */

const { app, BrowserWindow, Menu, shell, nativeTheme, dialog, screen, powerSaveBlocker } = require('electron');
const fs = require('fs');
const net = require('net');
const path = require('path');

const RAIZ = path.join(__dirname, '..');
const ICONE = path.join(RAIZ, 'public', 'icones', 'salvatudo.ico');

app.setAppUserModelId('com.ihagomartins.salvatudo');

// Uma janela só: abrir o atalho de novo traz a que já está aberta.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

/** @type {BrowserWindow | null} */
let janela = null;
let urlBase = '';
let fechandoDeVez = false;

/* ---------------- porta livre ---------------- */

function portaLivre(porta) {
  return new Promise((resolve) => {
    const teste = net.createServer();
    teste.once('error', () => resolve(false));
    teste.once('listening', () => teste.close(() => resolve(true)));
    teste.listen(porta, '127.0.0.1');
  });
}

async function escolherPorta() {
  for (let p = 3150; p < 3200; p += 1) if (await portaLivre(p)) return p;
  return 0; // o sistema escolhe
}

/* ---------------- tamanho e posição da janela ---------------- */

const arquivoJanela = () => path.join(app.getPath('userData'), 'janela.json');

function lerEstadoJanela() {
  try { return JSON.parse(fs.readFileSync(arquivoJanela(), 'utf8')); } catch (_) { return {}; }
}

function guardarEstadoJanela() {
  if (!janela || janela.isDestroyed() || janela.isMinimized()) return;
  const estado = janela.isMaximized()
    ? { ...lerEstadoJanela(), maximizada: true }
    : { maximizada: false, limites: janela.getBounds() };
  try { fs.writeFileSync(arquivoJanela(), JSON.stringify(estado)); } catch (_) { /* sem problema */ }
}

/** Posição salva só vale se ainda cair dentro de algum monitor. */
function limitesValidos(limites) {
  if (!limites) return null;
  const visivel = screen.getAllDisplays().some(({ workArea: a }) => limites.x < a.x + a.width - 80
    && limites.x + limites.width > a.x + 80 && limites.y >= a.y - 10 && limites.y < a.y + a.height - 80);
  return visivel ? limites : null;
}

/* ---------------- janela ---------------- */

function criarJanela() {
  const salvo = lerEstadoJanela();
  janela = new BrowserWindow({
    width: 1320,
    height: 880,
    ...(limitesValidos(salvo.limites) || {}),
    minWidth: 380,
    minHeight: 520,
    show: false,
    title: 'SalvaTudo',
    icon: ICONE,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0d0e12' : '#f3f4f8',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (salvo.maximizada) janela.maximize();

  janela.once('ready-to-show', () => janela && janela.show());
  janela.on('resize', guardarEstadoJanela);
  janela.on('move', guardarEstadoJanela);
  janela.on('close', (e) => {
    guardarEstadoJanela();
    if (fechandoDeVez || !janela) return;
    const fila = require(path.join(RAIZ, 'src', 'nucleo', 'fila.js'));
    const r = fila.resumo();
    if (!r.ocupado) return;
    const escolha = dialog.showMessageBoxSync(janela, {
      type: 'question',
      title: 'SalvaTudo',
      message: `Ainda ${r.emCurso + r.aguardando === 1 ? 'tem 1 download' : `tem ${r.emCurso + r.aguardando} downloads`} em andamento.`,
      detail: 'Se fechar agora, eles continuam de onde pararam na próxima vez que você abrir o SalvaTudo.',
      buttons: ['Continuar baixando', 'Fechar mesmo assim'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (escolha === 0) e.preventDefault();
    else fechandoDeVez = true;
  });
  janela.on('closed', () => { janela = null; });

  // Links para fora (Instagram, ajuda) abrem no navegador de sempre.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url) && !url.startsWith(urlBase)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(urlBase)) {
      e.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  janela.loadURL(urlBase);
}

/* ---------------- barra de tarefas e energia ---------------- */

/** @type {number | null} */
let bloqueioSono = null;

function acompanharFila() {
  const fila = require(path.join(RAIZ, 'src', 'nucleo', 'fila.js'));
  // fechando: para os downloads na hora (eles continuam da próxima vez) sem deixar o FFmpeg órfão
  app.on('will-quit', () => fila.encerrar());
  fila.aoResumo((r) => {
    if (janela && !janela.isDestroyed()) {
      // barra verde no ícone da barra de tarefas, como a de copiar arquivos do Windows
      if (r.ocupado) janela.setProgressBar(r.pct != null ? Math.max(0.02, r.pct / 100) : 2, { mode: r.pct != null ? 'normal' : 'indeterminate' });
      else janela.setProgressBar(-1);
    }
    // não deixa o computador dormir no meio de um download
    if (r.ocupado && bloqueioSono == null) bloqueioSono = powerSaveBlocker.start('prevent-app-suspension');
    if (!r.ocupado && bloqueioSono != null) {
      powerSaveBlocker.stop(bloqueioSono);
      bloqueioSono = null;
    }
  });
}

/* ---------------- início ---------------- */

app.on('second-instance', () => {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
});

app.on('window-all-closed', () => app.quit());

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  const porta = await escolherPorta();
  process.env.ABRIR = '0';
  process.env.SALVATUDO_LOG = '1';
  // SALVATUDO_DADOS já definido (uso portátil, testes) tem prioridade
  process.env.SALVATUDO_DADOS = process.env.SALVATUDO_DADOS || path.join(app.getPath('userData'), 'dados');

  try {
    const { iniciar } = require(path.join(RAIZ, 'src', 'server.js'));
    const r = await iniciar({ abrirJanela: false, modoApp: false, unicaInstancia: false, porta });
    urlBase = r.url;
  } catch (err) {
    dialog.showErrorBox('SalvaTudo', `Não foi possível iniciar o SalvaTudo.\n\n${err && err.message ? err.message : err}`);
    app.quit();
    return;
  }

  acompanharFila();
  criarJanela();
});
