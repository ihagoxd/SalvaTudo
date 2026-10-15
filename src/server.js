'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');

const config = require('./config');
const eventos = require('./nucleo/eventos');
const janela = require('./nucleo/janela');
const configuracao = require('./nucleo/configuracao');
const fila = require('./nucleo/fila');
const componentes = require('./motores/componentes');
const api = require('./rotas/api');

/* ---------------- registro em arquivo no modo app ---------------- */

// Sem janela de console (modo app ou instalador): o que der errado vai para dados/salvatudo.log.
if ((config.MODO_APP || process.env.SALVATUDO_LOG === '1') && !process.stdout.isTTY) {
  const log = fs.createWriteStream(path.join(config.pastas.dados, 'salvatudo.log'), { flags: 'a' });
  const escrever = (nivel) => (...partes) => {
    const linha = partes.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
    log.write(`[${new Date().toISOString()}] ${nivel} ${linha}\n`);
  };
  console.log = escrever('INFO');
  console.warn = escrever('AVISO');
  console.error = escrever('ERRO');
}

const app = express();
app.disable('x-powered-by');

/**
 * Só a própria janela do SalvaTudo conversa com o servidor. Um site aberto
 * no navegador não consegue mandar baixar nem abrir arquivos: o endereço
 * pedido tem de ser o local (contra "DNS rebinding") e pedidos que mudam
 * alguma coisa têm de vir desta mesma origem.
 */
function portaria(req, res, next) {
  const host = String(req.headers.host || '').toLowerCase();
  const porta = String(app.get('porta') || config.PORTA);
  const locais = [`127.0.0.1:${porta}`, `localhost:${porta}`, `[::1]:${porta}`];
  if (!locais.includes(host)) {
    res.status(403).type('text/plain').send('Acesso negado.');
    return;
  }
  const origem = req.headers.origin;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (origem && !locais.some((l) => origem === `http://${l}`)) {
      res.status(403).json({ ok: false, erro: 'Origem não permitida.' });
      return;
    }
    if (req.path.startsWith('/api/') && !/^application\/json/i.test(String(req.headers['content-type'] || '')) && req.headers['content-length'] !== '0' && req.method !== 'DELETE') {
      res.status(415).json({ ok: false, erro: 'Envie JSON.' });
      return;
    }
  }
  next();
}

app.use(portaria);
app.use(express.json({ limit: '5mb' }));

// Nada de cache nos arquivos do próprio app: uma atualização aparece na hora.
app.use((req, res, next) => {
  if (!req.path.startsWith('/vendor/')) res.set('Cache-Control', 'no-cache');
  next();
});

const nm = (...p) => path.join(config.RAIZ, 'node_modules', ...p);
const estatico = (dir, maxAge = '7d') => express.static(dir, { maxAge, fallthrough: false });

app.use('/vendor/preact', estatico(nm('preact', 'dist')));
app.use('/vendor/preact-hooks', estatico(nm('preact', 'hooks', 'dist')));
app.use('/vendor/htm', estatico(nm('htm', 'dist')));
app.use('/vendor/htm-preact', estatico(nm('htm', 'preact')));

app.use(express.static(path.join(config.RAIZ, 'public'), { etag: true, maxAge: 0 }));
app.use('/api', api);

// Aplicativo de página única: qualquer rota volta para o index.
app.get(/^\/(?!api\/|vendor\/).*/, (req, res) => {
  res.sendFile(path.join(config.RAIZ, 'public', 'index.html'));
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.parse.failed') {
    res.status(400).json({ ok: false, erro: 'Pedido inválido.' });
    return;
  }
  console.error('[erro]', err);
  if (res.headersSent) { res.end(); return; }
  res.status(500).type('text/plain').send('Erro inesperado.');
});

/* ---------------- inicialização ---------------- */

/** Prepara os componentes e procura atualização do yt-dlp sem atrapalhar a abertura. */
async function prepararComponentes() {
  await componentes.faxina();
  componentes.aoMudar((estado) => {
    eventos.publicar('componentes', estado);
    if (estado.pronto) fila.bombear();
  });
  const estado = await componentes.estado();
  if (!estado.pronto) return; // a tela mostra "Preparar" e a pessoa acompanha
  fila.bombear();
  if (configuracao.ler().atualizarAuto) {
    setTimeout(() => componentes.verificarAtualizacao().catch((e) => console.warn('[atualização]', e.message)), 8000).unref();
  }
}

/**
 * Sobe o servidor.
 * @param {object} [op]
 * @param {boolean} [op.abrirJanela]    abre a janela (Edge em modo app ou o navegador)
 * @param {boolean} [op.modoApp]        encerra quando a última janela fechar
 * @param {boolean} [op.unicaInstancia] se já houver um SalvaTudo nesta porta, só abre a janela dele
 * @param {number} [op.porta]
 * @returns {Promise<{url: string, servidor: http.Server} | null>} null quando outra instância assumiu
 */
async function iniciar({ abrirJanela = config.ABRIR_JANELA, modoApp = config.MODO_APP, unicaInstancia = true, porta = config.PORTA } = {}) {
  const urlDe = (p) => `http://127.0.0.1:${p}`;

  if (unicaInstancia && await janela.jaRodando(urlDe(porta))) {
    console.log(`  O SalvaTudo já está aberto em ${urlDe(porta)}`);
    if (abrirJanela) await janela.abrir(urlDe(porta));
    setTimeout(() => process.exit(0), 1500);
    return null;
  }

  const servidor = http.createServer(app);
  servidor.requestTimeout = 0; // a análise de playlists grandes pode demorar
  servidor.headersTimeout = 120000;
  servidor.keepAliveTimeout = 65000;

  await new Promise((resolve, reject) => {
    servidor.once('error', (/** @type {NodeJS.ErrnoException} */ err) => {
      if (err.code === 'EADDRINUSE') console.error(`  A porta ${porta} já está em uso por outro programa. Use PORT=outra_porta.`);
      else console.error(err);
      reject(err);
    });
    servidor.listen(porta, config.HOST, () => resolve(undefined));
  });
  const portaReal = /** @type {import('net').AddressInfo} */ (servidor.address()).port;
  app.set('porta', portaReal);
  const url = urlDe(portaReal);

  console.log('');
  console.log(`  SalvaTudo ${config.VERSAO} — vídeos e músicas na qualidade original`);
  console.log(`  Rodando em ${url}`);
  console.log('  Ctrl+C para encerrar.');
  console.log('');

  prepararComponentes().catch((e) => console.error('[componentes]', e));
  if (abrirJanela) await janela.abrir(url, { modoApp });
  if (modoApp) janela.encerrarQuandoFechar(eventos, () => fila.resumo().ocupado);
  return { url, servidor };
}

// Rede de segurança: um erro solto não pode derrubar o app no meio de um download.
process.on('unhandledRejection', (err) => console.error('[falha não tratada]', err));
process.on('uncaughtException', (err) => console.error('[erro inesperado]', err));
// Fechando: para os downloads (eles continuam da próxima vez) sem deixar o FFmpeg órfão.
process.on('exit', () => fila.encerrar());

// Rodando direto (node src/server.js): sobe sozinho. Dentro do app (Electron), quem chama é o main.
if (require.main === module) {
  iniciar().catch(() => process.exit(1));
  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => process.exit(0));
}

module.exports = { app, iniciar };
