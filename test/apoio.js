'use strict';

/**
 * Apoio dos testes de ponta a ponta: um "site" local que serve vídeos
 * gerados na hora pelo FFmpeg (com Range e velocidade limitada, para dar
 * tempo de pausar e cancelar) e o SalvaTudo rodando numa pasta temporária.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const EXE = process.platform === 'win32' ? '.exe' : '';
const TEMP = fs.mkdtempSync(path.join(process.env.SALVATUDO_TESTE_TEMP || os.tmpdir(), 'salvatudo-teste-'));

// os componentes já baixados ("npm run componentes") são reaproveitados
const COMPONENTES = process.env.SALVATUDO_COMPONENTES || path.join(RAIZ, 'dados', 'componentes');
process.env.SALVATUDO_COMPONENTES = COMPONENTES;
process.env.SALVATUDO_DADOS = path.join(TEMP, 'dados');
process.env.ABRIR = '0';

function acharFfmpeg() {
  const proprio = path.join(COMPONENTES, 'ffmpeg', `ffmpeg${EXE}`);
  if (fs.existsSync(proprio)) return proprio;
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const alvo = path.join(dir, `ffmpeg${EXE}`);
    if (fs.existsSync(alvo)) return alvo;
  }
  return null;
}

const FFMPEG = acharFfmpeg();
const TEM_YTDLP = fs.existsSync(path.join(COMPONENTES, `yt-dlp${EXE}`));
/** Motivo para pular os testes de download (ou null se dá para rodar). */
const FALTA = !TEM_YTDLP || !FFMPEG ? 'rode "npm run componentes" antes (precisa do yt-dlp e do FFmpeg)' : null;

/** Gera um vídeo de teste (imagem + som) com o FFmpeg. */
function gerarVideo(destino, { segundos = 3, largura = 640, altura = 360, taxa = '600k' } = {}) {
  execFileSync(FFMPEG, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=${largura}x${altura}:rate=30:duration=${segundos}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${segundos}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', taxa, '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', destino,
  ], { windowsHide: true });
  return destino;
}

/**
 * "Site" local com os arquivos de uma pasta. /lento/arquivo manda devagar.
 * @param {string} pasta
 * @returns {Promise<{url: string, fechar: () => Promise<void>}>}
 */
function siteLocal(pasta) {
  const servidor = http.createServer((req, res) => {
    const lento = req.url.startsWith('/lento/');
    const nome = decodeURIComponent(req.url.replace(/^\/(lento\/)?/, '').split('?')[0]);
    const arquivo = path.join(pasta, path.basename(nome));
    if (!fs.existsSync(arquivo)) { res.writeHead(404); res.end('não existe'); return; }
    const total = fs.statSync(arquivo).size;
    let inicio = 0;
    let fim = total - 1;
    const faixa = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (faixa) {
      inicio = Number(faixa[1]);
      if (faixa[2]) fim = Number(faixa[2]);
    }
    res.writeHead(faixa ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': fim - inicio + 1,
      'Accept-Ranges': 'bytes',
      ...(faixa ? { 'Content-Range': `bytes ${inicio}-${fim}/${total}` } : {}),
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const leitura = fs.createReadStream(arquivo, { start: inicio, end: fim, highWaterMark: 64 * 1024 });
    if (!lento) { leitura.pipe(res); return; }
    // ~1 MB/s: dá tempo de pausar e cancelar no meio
    leitura.on('data', (pedaco) => {
      leitura.pause();
      res.write(pedaco);
      setTimeout(() => leitura.resume(), 60);
    });
    leitura.on('end', () => res.end());
    res.on('close', () => leitura.destroy());
  });
  return new Promise((resolve) => {
    servidor.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('net').AddressInfo} */ (servidor.address());
      resolve({
        url: `http://127.0.0.1:${port}`,
        fechar: () => new Promise((ok) => { servidor.closeAllConnections(); servidor.close(() => ok(undefined)); }),
      });
    });
  });
}

/** Sobe o SalvaTudo numa porta livre e devolve um cliente da API. */
async function subirApp() {
  const { iniciar } = require('../src/server');
  const r = await iniciar({ abrirJanela: false, modoApp: false, unicaInstancia: false, porta: 0 });
  const base = r.url;
  const chamar = async (metodo, caminho, corpo) => {
    const resp = await fetch(`${base}/api${caminho}`, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const dados = await resp.json().catch(() => ({}));
    return { status: resp.status, ...dados };
  };
  return {
    base,
    servidor: r.servidor,
    get: (c) => chamar('GET', c),
    post: (c, corpo = {}) => chamar('POST', c, corpo),
    put: (c, corpo = {}) => chamar('PUT', c, corpo),
    del: (c) => chamar('DELETE', c),
  };
}

/** Espera uma condição (consultando a cada 250 ms). */
async function esperar(condicao, { ms = 90000, oQue = 'condição' } = {}) {
  const limite = Date.now() + ms;
  for (;;) {
    const r = await condicao();
    if (r) return r;
    if (Date.now() > limite) throw new Error(`Tempo esgotado esperando: ${oQue}`);
    await new Promise((ok) => setTimeout(ok, 250));
  }
}

/** Codecs de um arquivo, pelo ffprobe. */
function codecs(arquivo) {
  const ffprobe = path.join(path.dirname(FFMPEG), `ffprobe${EXE}`);
  const saida = execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', arquivo], { encoding: 'utf8', windowsHide: true });
  return saida.split(/\r?\n/).filter(Boolean).map((l) => l.split(',').reverse().join(':'));
}

/** Todos os arquivos dentro de uma pasta (caminhos relativos, com /). */
function listar(pasta) {
  if (!fs.existsSync(pasta)) return [];
  const saida = [];
  const andar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, e.name);
      if (e.isDirectory()) andar(completo);
      else saida.push(path.relative(pasta, completo).split(path.sep).join('/'));
    }
  };
  andar(pasta);
  return saida.sort();
}

function limpar() {
  try { fs.rmSync(TEMP, { recursive: true, force: true, maxRetries: 5 }); } catch (_) { /* arquivos presos no Windows */ }
}

module.exports = { TEMP, FALTA, gerarVideo, siteLocal, subirApp, esperar, codecs, listar, limpar };
