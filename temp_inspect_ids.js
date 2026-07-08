const path = require('path');
const fs = require('fs');
const rag = require(path.join(__dirname, 'src', 'engine', 'ragEngine.js'));
const indexPath = rag.getIndexPath();
const raw = fs.readFileSync(indexPath, 'utf8');
const idx = JSON.parse(raw || '[]');
const ids = [
  '6631dfc1-b46c-4933-a340-392dfd2250d6',
  'c2961b13-bd76-4f6b-9c39-1e19606b6a5d',
  'b411e939-1537-4fd5-af3d-541424f9d3a3',
  '618a0474-969a-463f-91cd-c010a27beb48',
  '8491b972-ee0b-4806-bd7e-8508c61ed46b',
  'c4b537df-3774-42de-b51c-82f5a35bdee6',
  '74be5da2-8251-4417-a1de-41c3a4b70239',
  '0f1c9e82-15a8-44a4-9fa8-0e9a2fd500b5'
];
for (const id of ids) {
  const item = idx.find(x => x.id === id);
  console.log('---', id, item ? item.filename : 'NOT_FOUND');
  if (item) {
    console.log(JSON.stringify({ filename: item.filename, chunkType: item.chunkType, category: item.category, docCategory: item.docCategory, trainingId: item.trainingId, chunk: (item.chunk||'').slice(0,360).replace(/\n/g,' '), program: item.program, title: item.title, lowConfidence: item.lowConfidence }, null, 2));
  }
}
