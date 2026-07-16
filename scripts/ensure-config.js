// Crea strategy.json / wallet.json / .env da example se mancano
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

const copies = [
  ['config/strategy.example.json', 'strategy.json'],
  ['wallet.example.json', 'wallet.json'],
  ['.env.example', '.env'],
];

for (const [srcRel, dstRel] of copies) {
  const src = path.join(root, srcRel);
  const dst = path.join(root, dstRel);
  if (!fs.existsSync(dst) && fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
    console.log(`[setup] creato ${dstRel} da ${srcRel}`);
  }
}
