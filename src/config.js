'use strict';

/**
 * Caminhos e opções do SalvaTudo. Tudo que depende do ambiente passa por aqui.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const argumentos = process.argv.slice(2);

const DIR_DADOS = process.env.SALVATUDO_DADOS
  ? path.resolve(process.env.SALVATUDO_DADOS)
  : path.join(RAIZ, 'dados');

const pastas = {
  dados: DIR_DADOS,
  // yt-dlp e FFmpeg (SALVATUDO_COMPONENTES: os testes reaproveitam os já baixados)
  componentes: process.env.SALVATUDO_COMPONENTES ? path.resolve(process.env.SALVATUDO_COMPONENTES) : path.join(DIR_DADOS, 'componentes'),
  cache: path.join(DIR_DADOS, 'cache'),             // cache do yt-dlp
  temp: path.join(DIR_DADOS, 'temp'),               // instalações em andamento
  navegador: path.join(DIR_DADOS, 'janela'),        // perfil da janela do app
};

for (const dir of Object.values(pastas)) fs.mkdirSync(dir, { recursive: true });

/** @type {string | null} */
let downloads = null;

/**
 * Pasta Downloads de verdade: muita gente move para outro disco (o Windows
 * guarda o lugar no registro), então "C:\Users\fulano\Downloads" pode nem existir.
 */
function pastaDownloadsPadrao() {
  if (downloads) return downloads;
  if (process.versions.electron) {
    try { downloads = require('electron').app.getPath('downloads'); } catch (_) { /* fora do processo principal */ }
  }
  if (!downloads && process.platform === 'win32') {
    try {
      const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path";
      const achado = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', windowsHide: true, timeout: 15000,
      }).trim();
      if (achado && fs.existsSync(achado)) downloads = achado;
    } catch (_) { /* segue para os lugares de sempre */ }
  }
  if (!downloads) {
    const casa = os.homedir();
    const candidatos = [path.join(casa, 'Downloads'), path.join(casa, 'Transferências'), casa];
    downloads = candidatos.find((c) => fs.existsSync(c)) || casa;
  }
  return downloads;
}

module.exports = {
  RAIZ,
  VERSAO: require('../package.json').version,
  PORTA: Number(process.env.PORT) || 3150,
  // Só a própria máquina enxerga o app.
  HOST: process.env.HOST || '127.0.0.1',
  MODO_APP: argumentos.includes('--app') || process.env.SALVATUDO_APP === '1',
  ABRIR_JANELA: process.env.ABRIR !== '0',
  pastas,
  ARQUIVO_CONFIG: path.join(DIR_DADOS, 'config.json'),
  ARQUIVO_FILA: path.join(DIR_DADOS, 'fila.json'),
  ARQUIVO_HISTORICO: path.join(DIR_DADOS, 'historico.json'),
  ARQUIVO_COMPONENTES: path.join(DIR_DADOS, 'componentes.json'),
  pastaDownloadsPadrao,
  LIMITE_HISTORICO: 2000,
};
