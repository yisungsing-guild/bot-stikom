const hf = require('../src/engine/humanizer');
const raw = 'Teknologi Informasi adalah program studi yang mempelajari perangkat lunak, jaringan, dan infrastruktur TI.';
const marketingPatterns = /(?:\n\s*\n)?(?:Untuk\s+meringankan\s+biaya|Silakan\s+hubungi\s+PMB|Beasiswa\s+KIP|Beasiswa\s+1K1S|Beasiswa\s+Prestasi|Beasiswa\s+Yayasan|Potongan\s+Biaya\s+Pendaftaran|Mau\s+saya\s+jelaskan[^\n]*beasiswa|Informasi\s+beasiswa|Biaya\s+pendaftaran|DPP|Dana\s+Pendidikan\s+Pokok|Biaya\s+Pendidikan\s+Per\s+Semester|UKT|cicilan|gelombang\s+pendaftaran|cara\s+mendaftar|persyaratan\s+pendaftaran)[\s\S]*$/i;
const m = marketingPatterns.exec(raw);
console.log('match', m);
console.log('replaced', raw.replace(marketingPatterns, ''));
console.log('lengths', raw.length, (raw.replace(marketingPatterns, '')).length);
