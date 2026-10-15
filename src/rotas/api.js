'use strict';

const fsp = require('fs/promises');
const path = require('path');
const express = require('express');

const config = require('../config');
const eventos = require('../nucleo/eventos');
const configuracao = require('../nucleo/configuracao');
const fila = require('../nucleo/fila');
const historico = require('../nucleo/historico');
const componentes = require('../motores/componentes');
const contas = require('../motores/contas');
const ytdlp = require('../motores/ytdlp');
const so = require('../motores/so');
const { ErroUsuario, extrairLinks, nomeSeguro } = require('../nucleo/util');

const router = express.Router();

/* ---------------- sistema ---------------- */

function espacos(cfg) {
  return {
    videos: so.espacoLivre(cfg.pastaVideos),
    musicas: so.espacoLivre(cfg.pastaMusicas),
    fotos: so.espacoLivre(cfg.pastaFotos),
  };
}

router.get('/sistema', async (req, res) => {
  const cfg = configuracao.ler();
  res.json({
    versao: config.VERSAO,
    app: so.NO_ELECTRON,
    plataforma: process.platform,
    config: cfg,
    padrao: configuracao.PADRAO,
    componentes: await componentes.estado(),
    contas: await contas.estado(),
    espaco: espacos(cfg),
    historico: historico.listar({ limite: 0 }).total,
  });
});

router.get('/eventos', (req, res) => eventos.conectar(req, res));

/* ---------------- analisar ---------------- */

router.post('/analisar', async (req, res) => {
  const texto = String((req.body && req.body.url) || '').trim();
  const links = extrairLinks(texto);
  if (!links.length) throw new ErroUsuario('Cole um link que comece com https://');

  // vários links de uma vez: entram como lista, cada um descobre o título ao baixar
  if (links.length > 1) {
    const ja = historico.chavesBaixadas();
    res.json({
      ok: true,
      resultado: {
        tipo: 'links',
        titulo: `${links.length} links`,
        quantidade: links.length,
        itens: links.map((url, i) => ({ indice: i + 1, url, titulo: url, chave: null, jaBaixado: ja.has(url) })),
      },
    });
    return;
  }

  const r = await ytdlp.analisar(links[0], { playlist: Boolean(req.body.playlist) });
  const resultado = { ...r };
  if (r.tipo === 'lista') {
    const ja = historico.chavesBaixadas();
    resultado.itens = r.itens.map((i) => ({ ...i, jaBaixado: Boolean(i.chave && ja.has(i.chave)) }));
  } else {
    resultado.jaBaixado = historico.porChave(r.chave);
    // vídeo aberto dentro de uma playlist do YouTube: dá para pedir a lista toda
    try {
      const u = new URL(links[0]);
      resultado.temPlaylist = r.tipo === 'midia' && u.searchParams.has('list') && !/^(RD|UL)/.test(u.searchParams.get('list') || '');
    } catch (_) { resultado.temPlaylist = false; }
  }
  res.json({ ok: true, resultado });
});

/* ---------------- baixar ---------------- */

const QUALIDADE = /^(max|\d{3,4})$/;

router.post('/baixar', async (req, res) => {
  const b = req.body || {};
  const cfg = configuracao.ler();
  const tipo = ['video', 'audio', 'fotos'].includes(b.tipo) ? b.tipo : null;
  if (!tipo) throw new ErroUsuario('Escolha vídeo, áudio ou fotos.');
  const lista = Array.isArray(b.itens) ? b.itens.filter((i) => i && /^https?:\/\//i.test(String(i.url || ''))) : [];
  if (!lista.length) throw new ErroUsuario('Nada para baixar.');
  if (lista.length > 5000) throw new ErroUsuario('No máximo 5.000 itens por vez.');

  const padraoPasta = { video: cfg.pastaVideos, audio: cfg.pastaMusicas, fotos: cfg.pastaFotos }[tipo];
  const pasta = typeof b.pasta === 'string' && path.isAbsolute(b.pasta) ? path.normalize(b.pasta) : padraoPasta;
  try {
    await fsp.mkdir(pasta, { recursive: true });
  } catch (_) {
    throw new ErroUsuario('Não consegui criar a pasta escolhida. Escolha outra.');
  }

  const grupo = b.grupo && b.grupo.titulo ? { id: String(b.grupo.id || ''), titulo: String(b.grupo.titulo) } : null;
  const numerar = cfg.numerarPlaylist && b.numerar !== false;
  const total = Number(b.grupo && b.grupo.quantidade) || lista.length;
  const qualidade = QUALIDADE.test(String(b.qualidade)) ? String(b.qualidade) : 'max';
  const formatoVideo = configuracao.OPCOES.formatoVideo.includes(b.formatoVideo) ? b.formatoVideo : cfg.formatoVideo;
  const formatoAudio = configuracao.OPCOES.formatoAudio.includes(b.formatoAudio) ? b.formatoAudio : cfg.formatoAudio;

  const r = fila.adicionar(lista.map((i) => ({
    url: String(i.url),
    titulo: typeof i.titulo === 'string' ? i.titulo.slice(0, 300) : undefined,
    miniatura: typeof i.miniatura === 'string' ? i.miniatura : undefined,
    canal: typeof i.canal === 'string' ? i.canal : undefined,
    duracao: Number(i.duracao) || undefined,
    site: typeof i.site === 'string' ? i.site : undefined,
    chave: typeof i.chave === 'string' ? i.chave : undefined,
    grupo,
    pedido: {
      tipo,
      qualidade,
      formatoVideo,
      formatoAudio,
      pasta,
      subpasta: grupo ? nomeSeguro(grupo.titulo, 100) : '',
      indice: grupo && numerar ? Number(i.indice) || undefined : undefined,
      totalLista: grupo && numerar ? total : undefined,
      organizar: tipo === 'audio' ? cfg.organizarMusicas : cfg.organizarVideos,
      legendas: Boolean(b.legendas),
      capaQuadrada: cfg.capaQuadrada,
      musica: b.musica !== false,
      lives: b.lives !== false,
    },
  })));

  // a próxima vez já abre com as mesmas escolhas
  if (tipo !== 'fotos') configuracao.salvar({ tipoPadrao: tipo, formatoVideo, formatoAudio });
  res.json({ ok: true, adicionados: r.adicionados.length, repetidos: r.repetidos });
});

/* ---------------- fila ---------------- */

router.get('/fila', (req, res) => {
  res.json({ ok: true, itens: fila.listar(), resumo: fila.resumo() });
});

router.post('/fila/todos/:acao', async (req, res) => {
  const acoes = {
    'pausar': fila.pausarTudo,
    'retomar': fila.retomarTudo,
    'limpar': fila.limparFinalizados,
    'tentar-erros': fila.tentarErrosDeNovo,
  };
  const fn = acoes[req.params.acao];
  if (!fn) throw new ErroUsuario('Ação desconhecida.', 404);
  await fn();
  res.json({ ok: true });
});

function itemDaFila(id) {
  const item = fila.pegar(id);
  if (!item) throw new ErroUsuario('Esse download não está mais na lista.', 404);
  return item;
}

router.post('/fila/:id/:acao', async (req, res) => {
  const item = itemDaFila(req.params.id);
  const acao = req.params.acao;
  if (acao === 'pausar') await fila.pausar(item.id);
  else if (acao === 'retomar' || acao === 'tentar') fila.retomar(item.id);
  else if (acao === 'cancelar') await fila.cancelar(item.id);
  else if (acao === 'abrir' || acao === 'mostrar') {
    if (!item.arquivo) throw new ErroUsuario('O arquivo ainda não está pronto.');
    const ok = acao === 'abrir' ? await so.abrirArquivo(item.arquivo) : await so.mostrarNaPasta(item.arquivo);
    if (!ok) throw new ErroUsuario('Não consegui abrir. O arquivo foi movido ou apagado?');
  } else throw new ErroUsuario('Ação desconhecida.', 404);
  res.json({ ok: true });
});

router.delete('/fila/:id', async (req, res) => {
  await fila.remover(req.params.id);
  res.json({ ok: true });
});

/* ---------------- histórico ---------------- */

router.get('/historico', (req, res) => {
  res.json({ ok: true, ...historico.listar({ busca: String(req.query.busca || ''), tipo: String(req.query.tipo || '') }) });
});

router.post('/historico/limpar', (req, res) => {
  historico.limpar();
  res.json({ ok: true });
});

router.post('/historico/:id/:acao', async (req, res) => {
  const r = historico.porId(req.params.id);
  if (!r) throw new ErroUsuario('Esse registro não existe mais.', 404);
  const ok = req.params.acao === 'abrir' ? await so.abrirArquivo(r.arquivo) : await so.mostrarNaPasta(r.arquivo);
  if (!ok) throw new ErroUsuario('Não consegui abrir. O arquivo foi movido ou apagado?');
  res.json({ ok: true });
});

router.delete('/historico/:id', (req, res) => {
  historico.remover(req.params.id);
  res.json({ ok: true });
});

/* ---------------- configurações e pastas ---------------- */

router.get('/config', (req, res) => res.json({ ok: true, config: configuracao.ler() }));

router.put('/config', (req, res) => {
  const cfg = configuracao.salvar(req.body || {});
  eventos.publicar('config', { config: cfg, espaco: espacos(cfg) });
  res.json({ ok: true, config: cfg, espaco: espacos(cfg) });
});

router.post('/escolher-pasta', async (req, res) => {
  const inicial = typeof req.body.inicial === 'string' ? req.body.inicial : '';
  const pasta = await so.escolherPasta(inicial);
  res.json({ ok: true, pasta, espaco: pasta ? so.espacoLivre(pasta) : null });
});

router.post('/abrir-pasta', async (req, res) => {
  const cfg = configuracao.ler();
  const pasta = { videos: cfg.pastaVideos, musicas: cfg.pastaMusicas, fotos: cfg.pastaFotos }[req.body.qual];
  if (!pasta) throw new ErroUsuario('Pasta desconhecida.');
  await fsp.mkdir(pasta, { recursive: true });
  await so.mostrarNaPasta(pasta);
  res.json({ ok: true });
});

/** Link copiado agora há pouco (para oferecer "baixar o link copiado"). */
router.get('/area-transferencia', async (req, res) => {
  if (!configuracao.ler().vigiarAreaTransferencia) { res.json({ ok: true, link: null }); return; }
  const texto = await so.lerAreaTransferencia();
  res.json({ ok: true, link: extrairLinks(texto.slice(0, 5000))[0] || null });
});

router.post('/abrir-link', (req, res) => {
  const url = String(req.body.url || '');
  // só os links do próprio app (crédito e página do projeto)
  if (!/^https:\/\/(www\.instagram\.com\/ihagomartins1|github\.com\/ihagoxd\/SalvaTudo)/.test(url)) throw new ErroUsuario('Link não permitido.');
  so.abrirLink(url);
  res.json({ ok: true });
});

/* ---------------- componentes ---------------- */

router.post('/componentes/instalar', (req, res) => {
  componentes.instalar().then(() => fila.bombear()).catch(() => { /* o erro vai pelo evento */ });
  res.json({ ok: true });
});

router.post('/componentes/atualizar', async (req, res) => {
  const r = await componentes.verificarAtualizacao({ forcar: true });
  res.json({ ok: true, ...r });
});

/* ---------------- contas ---------------- */

router.get('/contas', async (req, res) => res.json({ ok: true, ...(await contas.estado()) }));

router.post('/contas/:id/:acao', async (req, res) => {
  if (!contas.disponivel()) throw new ErroUsuario('Conectar contas funciona no app do SalvaTudo (instalado).');
  if (!contas.SITES.some((s) => s.id === req.params.id)) throw new ErroUsuario('Site desconhecido.', 404);
  let conectou = false;
  if (req.params.acao === 'entrar') conectou = await contas.entrar(req.params.id);
  else if (req.params.acao === 'sair') await contas.sair(req.params.id);
  else throw new ErroUsuario('Ação desconhecida.', 404);
  const estado = await contas.estado();
  eventos.publicar('contas', estado);
  res.json({ ok: true, conectou, ...estado });
});

/* ---------------- erros ---------------- */

router.use((req, res) => res.status(404).json({ ok: false, erro: 'Não encontrado.' }));

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  const conhecido = err instanceof ErroUsuario || err instanceof ytdlp.ErroDownload;
  if (!conhecido) console.error('[api]', err);
  if (err && err.type === 'entity.parse.failed') {
    res.status(400).json({ ok: false, erro: 'Pedido inválido.' });
    return;
  }
  res.status(conhecido ? (err.status || 422) : 500).json({
    ok: false,
    erro: conhecido ? err.message : 'Erro inesperado. Tente de novo.',
    detalhe: (err && err.detalhe) || null,
    conta: (err && err.conta) || null,
  });
});

module.exports = router;
