'use strict';

/**
 * Teste contra os sites de verdade. Depende da internet e dos sites, então
 * só roda quando pedido:  SALVATUDO_TESTAR_SITES=1 npm test
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const apoio = require('./apoio');

const ligado = process.env.SALVATUDO_TESTAR_SITES === '1';
const opcoes = { skip: !ligado ? 'só com SALVATUDO_TESTAR_SITES=1' : apoio.FALTA || false, timeout: 240000 };
const SAIDA = path.join(apoio.TEMP, 'sites');

/** @type {Awaited<ReturnType<typeof apoio.subirApp>>} */
let app;

before(async () => {
  if (opcoes.skip) return;
  app = await apoio.subirApp();
  await app.put('/config', { pastaVideos: path.join(SAIDA, 'Vídeos'), pastaMusicas: path.join(SAIDA, 'Músicas'), pastaFotos: path.join(SAIDA, 'Fotos') });
});

after(() => {
  if (app) app.servidor.close();
  apoio.limpar();
});

async function baixarEEsperar(corpo) {
  const r = await app.post('/baixar', corpo);
  assert.equal(r.ok, true, r.erro);
  return apoio.esperar(async () => {
    const f = await app.get('/fila');
    const i = f.itens.find((x) => x.url === corpo.itens[0].url && x.pedido.tipo === corpo.tipo);
    return i && ['concluido', 'erro'].includes(i.estado) ? i : null;
  }, { ms: 200000, oQue: corpo.itens[0].url });
}

test('YouTube: analisa e baixa (o primeiro vídeo do YouTube, 19 s)', opcoes, async () => {
  const a = await app.post('/analisar', { url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw' });
  assert.equal(a.resultado.tipo, 'midia', a.erro);
  assert.equal(a.resultado.canal, 'jawed');
  const item = await baixarEEsperar({ tipo: 'video', qualidade: 'max', formatoVideo: 'mp4', itens: [{ url: a.resultado.url }] });
  assert.equal(item.estado, 'concluido', item.erro || '');
  assert.equal(path.basename(path.dirname(item.arquivo)), 'jawed');
});

test('TikTok: vídeo sem marca d\'água', opcoes, async () => {
  const a = await app.post('/analisar', { url: 'https://www.tiktok.com/@scout2015/video/6718335390845095173' });
  assert.equal(a.resultado.tipo, 'midia', a.erro);
  const item = await baixarEEsperar({ tipo: 'video', itens: [{ url: a.resultado.url }] });
  assert.equal(item.estado, 'concluido', item.erro || '');
  assert.ok(!/#/.test(path.basename(item.arquivo)), 'nome sem hashtags');
});

test('TikTok: post de fotos, cada foto original e a música', opcoes, async () => {
  const a = await app.post('/analisar', { url: 'https://www.tiktok.com/@thinkpad.x270.lover/photo/7594147928399219990' });
  assert.equal(a.resultado.tipo, 'fotos', a.erro);
  assert.ok(a.resultado.fotos.length >= 2);
  const item = await baixarEEsperar({ tipo: 'fotos', musica: true, itens: [{ url: a.resultado.url }] });
  assert.equal(item.estado, 'concluido', item.erro || '');
  const arquivos = apoio.listar(item.arquivo);
  assert.ok(arquivos.includes('01.jpg') && arquivos.some((f) => f.endsWith('.mp3')), arquivos.join(', '));
});

test('SoundCloud: só áudio', opcoes, async () => {
  const a = await app.post('/analisar', { url: 'https://soundcloud.com/ethmusic/lostin-powers-she-so-heavy' });
  assert.equal(a.resultado.tipo, 'midia', a.erro);
  assert.equal(a.resultado.temVideo, false);
});

test('Pinterest: vídeo de um pin', opcoes, async () => {
  const a = await app.post('/analisar', { url: 'https://br.pinterest.com/pin/664281013778109217/' });
  assert.equal(a.resultado.tipo, 'midia', a.erro);
  assert.equal(a.resultado.temVideo, true);
});

test('Spotify: avisa na hora que não dá (DRM)', opcoes, async () => {
  const a = await app.post('/analisar', { url: 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT' });
  assert.equal(a.ok, false);
  assert.match(a.erro, /DRM/);
});
