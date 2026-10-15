'use strict';

/**
 * Gera public/js/logos.js só com os logos das redes que o app mostra,
 * tirados do Simple Icons (licença CC0). Rode "npm run logos" depois de
 * mudar a lista ou atualizar o simple-icons.
 */

const fs = require('fs');
const path = require('path');
const si = require('simple-icons');

const QUERO = {
  youtube: 'siYoutube',
  instagram: 'siInstagram',
  tiktok: 'siTiktok',
  facebook: 'siFacebook',
  x: 'siX',
  pinterest: 'siPinterest',
  soundcloud: 'siSoundcloud',
  twitch: 'siTwitch',
  kick: 'siKick',
  vimeo: 'siVimeo',
  reddit: 'siReddit',
  dailymotion: 'siDailymotion',
  bluesky: 'siBluesky',
  bandcamp: 'siBandcamp',
  threads: 'siThreads',
};

const linhas = [
  '// Gerado por scripts/gerar-logos.js a partir do Simple Icons (CC0). Não edite à mão.',
  '// cor: a cor da marca; null quando a marca é preta (usa a cor do texto, para aparecer no tema escuro).',
  'export const LOGOS = {',
];
for (const [id, chave] of Object.entries(QUERO)) {
  const icone = si[chave];
  if (!icone) throw new Error(`${chave} não existe no simple-icons`);
  const escuro = /^(0{6}|0a0a0a|000)$/i.test(icone.hex);
  linhas.push(`  ${id}: { cor: ${escuro ? 'null' : `'#${icone.hex}'`}, d: '${icone.path}' },`);
}
linhas.push('};', '');

const destino = path.join(__dirname, '..', 'public', 'js', 'logos.js');
fs.writeFileSync(destino, linhas.join('\n'), 'utf8');
console.log(`Logos gerados em ${path.relative(process.cwd(), destino)} (${Object.keys(QUERO).length})`);
