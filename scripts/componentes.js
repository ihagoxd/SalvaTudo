'use strict';

/**
 * Baixa (ou atualiza) o yt-dlp e o FFmpeg pela linha de comando:
 *   npm run componentes            instala o que falta
 *   npm run componentes -- --atualizar   baixa o yt-dlp mais novo
 * O app faz o mesmo sozinho na primeira vez; isto serve para os testes e o CI.
 */

const componentes = require('../src/motores/componentes');

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
let ultimo = '';
componentes.aoMudar((e) => {
  if (!e.instalando) return;
  const { etapa, baixado, total } = e.instalando;
  const linha = total ? `${etapa}: ${mb(baixado)} de ${mb(total)}` : etapa;
  if (linha.split(':')[0] !== ultimo.split(':')[0] || Date.now() % 7 === 0) console.log(`  ${linha}`);
  ultimo = linha;
});

(async () => {
  const atualizar = process.argv.includes('--atualizar');
  await componentes.instalar({ atualizarYtdlp: atualizar });
  const e = await componentes.estado();
  console.log(`  yt-dlp ${e.ytdlp.versao || '?'} (${e.ytdlp.caminho})`);
  console.log(`  FFmpeg ${e.ffmpeg.versao || '?'} (${e.ffmpeg.caminho})`);
  if (!e.pronto) process.exit(1);
})().catch((err) => {
  console.error(`  Erro: ${err.message}`);
  process.exit(1);
});
