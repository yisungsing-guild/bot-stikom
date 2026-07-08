const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, 'final_wa_outputs.log');
const text = fs.readFileSync(p, 'utf8');
const blocks = text.split('=== FINAL WA MESSAGE ===');
for (let i = 1; i < blocks.length; i++) {
  const block = blocks[i];
  const firstLine = block.trim().split(/\r?\n/)[0] || '';
  if (firstLine.startsWith('Baik kak, saya bantu cek ya.')) {
    if (!block.includes('Untuk program studi') && !block.includes('DPP') && !block.includes('Rp ')) {
      console.log('BLOCK', i);
      console.log(block.slice(0, 400));
      console.log('---');
    }
  }
}
