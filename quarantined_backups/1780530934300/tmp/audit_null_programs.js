const fs = require('fs');
const path = require('path');
const rag = require('../src/engine/ragEngine');

const indexPath = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
const indexRaw = fs.readFileSync(indexPath, 'utf8');
const idx = JSON.parse(indexRaw);
const nullItems = idx.filter((item) => !item || !item.program);

const cats = {
  'Dokumen administrasi': [
    /undang[- ]?undang/i,
    /surat keputusan/i,
    /keputusan/i,
    /rektor/i,
    /kepala/i,
    /sekretaris/i,
    /izin/i,
    /notulen/i,
    /putusan/i,
    /peraturan/i,
    /instruksi/i,
    /\bsk\b/i,
    /surat /i,
    /pemberitahuan/i,
    /pengumuman/i,
    /administrasi/i,
    /laporan kegiatan/i,
    /kegiatan/i,
    /proposal/i,
    /nota dinas/i,
    /nota/i,
    /persyaratan/i
  ],
  'Dokumen akreditasi': [
    /akreditasi/i,
    /ban-pt/i,
    /banpt/i,
    /peringkat akreditasi/i,
    /surat akreditasi/i,
    /sk akreditasi/i,
    /perguruan tinggi terakreditasi/i
  ],
  'Dokumen biaya': [
    /biaya/i,
    /spp/i,
    /dana pendidikan pokok/i,
    /dpp/i,
    /ukt/i,
    /uang kuliah tunggal/i,
    /uang kuliah/i,
    /pendaftaran/i,
    /gelombang/i,
    /pembayaran/i,
    /harga/i,
    /tarif/i,
    /beasiswa/i,
    /potongan/i
  ],
  'Dokumen program studi': [
    /program studi/i,
    /prodi/i,
    /jurusan/i,
    /sistem informasi/i,
    /teknologi informasi/i,
    /bisnis digital/i,
    /sistem komputer/i,
    /manajemen informatika/i,
    /desain komunikasi visual/i,
    /multimedia/i,
    /animasi/i,
    /teknologi komputer/i,
    /rekayasa perangkat lunak/i,
    /perangkat lunak/i
  ],
  'Dokumen RPL': [
    /rekognisi pembelajaran lampau/i,
    /rpl/i,
    /rekognisi pembelajaran/i,
    /pengakuan sks/i
  ],
  'Dokumen formulir': [
    /formulir/i,
    /daftar isi/i,
    /lampiran/i,
    /template/i,
    /isi data/i,
    /kolom/i,
    /pertanyaan/i,
    /survei/i,
    /kuisioner/i
  ]
};
const ordered = [
  'Dokumen program studi',
  'Dokumen RPL',
  'Dokumen biaya',
  'Dokumen akreditasi',
  'Dokumen formulir',
  'Dokumen administrasi'
];
const classified = {};
for (const key of Object.keys(cats)) classified[key] = [];
classified['Dokumen lain'] = [];

for (const item of nullItems) {
  const chunk = String(item && item.chunk ? item.chunk : '');
  const lower = chunk.toLowerCase();
  let matched = false;
  for (const cat of ordered) {
    if (cats[cat].some((re) => re.test(lower))) {
      classified[cat].push(item);
      matched = true;
      break;
    }
  }
  if (!matched) {
    classified['Dokumen lain'].push(item);
  }
}

const lines = [];
lines.push(`total_null=${nullItems.length}`);
for (const [cat, items] of Object.entries(classified)) {
  const filenames = Array.from(new Set(items.map((it) => it.filename || it.sourceFile || 'UNKNOWN'))).sort();
  lines.push(`CATEGORY: ${cat} count=${items.length}`);
  lines.push(`  filenames sample=${filenames.slice(0, 10).join(', ')}`);
}

lines.push('\nSAMPLES 100 NULL CHUNKS:');
for (let i = 0; i < Math.min(100, nullItems.length); i += 1) {
  const item = nullItems[i];
  const category = Object.entries(classified).find(([, its]) => its.includes(item));
  const catName = category ? category[0] : 'Dokumen lain';
  const filename = item.filename || item.sourceFile || 'UNKNOWN';
  const snippet = String(item.chunk || '').trim().replace(/\r?\n/g, '\\n');
  lines.push(`--- ${i + 1} id=${item.id} filename=${filename} category=${catName}`);
  lines.push(`  snippet=${snippet.slice(0, 300)}`);
}

lines.push('\nSUSPICIOUS KEYWORD NULL CHUNKS:');
const suspiciousRe = /program studi|prodi|jurusan|sistem informasi|teknologi informasi|bisnis digital|sistem komputer/i;
let suspiciousCount = 0;
for (const item of nullItems) {
  const chunk = String(item && item.chunk ? item.chunk : '');
  if (suspiciousRe.test(chunk)) {
    suspiciousCount += 1;
    if (suspiciousCount <= 50) {
      const filename = item.filename || item.sourceFile || 'UNKNOWN';
      const norm = rag.normalizeProgramLabel(chunk);
      lines.push(`id=${item.id} filename=${filename} program=${item.program} normalize=${norm}`);
    }
  }
}
lines.push(`total suspicious count=${suspiciousCount}`);

const outPath = path.join(__dirname, 'audit_null_programs.txt');
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log('Written', outPath);
