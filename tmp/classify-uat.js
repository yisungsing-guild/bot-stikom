const fs=require('fs');
const summary=JSON.parse(fs.readFileSync('tmp/uat-summary.json','utf8'));
const major = new Set([
  'Kapan pendaftaran beasiswa KIP dibuka?',
  'Apa syarat beasiswa prestasi?',
  'Bagaimana mengajukan beasiswa prestasi?',
  'Berapa besar potongan beasiswa prestasi?',
  'Bagaimana cara daftar PMB?',
  'Apa fasilitas kampus yang tersedia?',
  'Bagaimana akses kantin dan fasilitas olahraga?',
  'Bagaimana cara menuju kampus dengan transportasi umum?',
  'Berapa biaya masuk TI?',
  'Berapa biaya kuliah Sistem Informasi per semester?',
  'Biaya Bisnis Digital berapa?',
  'Berapa biaya Sistem Komputer di ITB STIKOM Bali?',
  'Berapa DPP untuk TI?',
  'Berapa biaya pendaftaran untuk SI?',
  'Apa saja persyaratan beasiswa 1K1S?',
  'Apakah beasiswa 1K1S tersedia untuk TI?',
  'Apakah ada laboratorium komputer di kampus?'
]);
const minor = new Set([
  'Coba jelaskan beasiswa yayasan yang ada di STIKOM Bali.',
  'Apa saja kriteria beasiswa yayasan?',
  'Bagaimana mendaftar beasiswa yayasan?',
  'Apakah semua prodi di STIKOM Bali terakreditasi?',
  'Bagaimana akreditasi TI?',
  'Apa perbedaan akreditasi SI dengan TI?'
]);
const counts={PASS:0,MINOR:0,MAJOR:0};
const rows=[];
for(const item of summary){ let category='PASS'; if(major.has(item.query)) category='MAJOR'; else if(minor.has(item.query)) category='MINOR'; counts[category]++; rows.push({query:item.query, category, finalIntent:item.finalIntent, ragUsed:item.ragUsed}); }
console.log(JSON.stringify(counts,null,2));
console.log(rows.map(r=>`${r.category}: ${r.query}`).join('\n'));
