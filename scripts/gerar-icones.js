'use strict';

/**
 * Gera os ícones do app a partir do SVG: PNG (janela, PWA) e ICO (atalho do
 * Windows). Rode com "npm run icones" depois de mudar o logo.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PASTA = path.join(__dirname, '..', 'public', 'icones');
const svg = fs.readFileSync(path.join(PASTA, 'salvatudo.svg'));

async function png(tamanho) {
  return sharp(svg, { density: Math.max(72, Math.round((72 * tamanho) / 128)) })
    .resize(tamanho, tamanho)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/** Arquivo .ico com várias resoluções (PNG dentro, aceito desde o Windows Vista). */
function ico(imagens) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0);
  cabecalho.writeUInt16LE(1, 2);
  cabecalho.writeUInt16LE(imagens.length, 4);
  const entradas = [];
  let deslocamento = 6 + imagens.length * 16;
  for (const { tamanho, dados } of imagens) {
    const e = Buffer.alloc(16);
    e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 0);
    e.writeUInt8(tamanho >= 256 ? 0 : tamanho, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(dados.length, 8);
    e.writeUInt32LE(deslocamento, 12);
    deslocamento += dados.length;
    entradas.push(e);
  }
  return Buffer.concat([cabecalho, ...entradas, ...imagens.map((i) => i.dados)]);
}

(async () => {
  fs.writeFileSync(path.join(PASTA, 'salvatudo-192.png'), await png(192));
  fs.writeFileSync(path.join(PASTA, 'salvatudo-512.png'), await png(512));
  const tamanhos = [16, 24, 32, 48, 64, 128, 256];
  const imagens = [];
  for (const t of tamanhos) imagens.push({ tamanho: t, dados: await png(t) });
  fs.writeFileSync(path.join(PASTA, 'salvatudo.ico'), ico(imagens));
  console.log('Ícones gerados em public/icones');
})();
