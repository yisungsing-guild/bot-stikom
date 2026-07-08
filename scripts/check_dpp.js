#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseCompactRupiahNumber(raw, opts = {}) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const digits = s.replace(/[^0-9.]/g, '').replace(/\./g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  const min = Number.isFinite(opts.min) ? opts.min : 10000;
  const max = Number.isFinite(opts.max) ? opts.max : 250_000_000;
  if (n < min || n > max) return null;
  return n;
}

function getBundledIndexCorpus() {
  const p = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return raw;
  return parsed.map(x => (x && typeof x.chunk === 'string' ? x.chunk : (x && typeof x.content === 'string' ? x.content : ''))).filter(Boolean).join('\n\n');
}

function extractFeeBasicsFromSection(section) {
  const s = String(section || '').replace(/\r/g, '\n').replace(/\n+/g, '\n').replace(/\s{2,}/g, ' ').trim();
  if (!s) return null;
  const grab = (res, opts = {}) => {
    for (const re of res) {
      const m = re.exec(s);
      if (m && m[1]) {
        const n = parseCompactRupiahNumber(m[1], opts);
        if (n) return n;
      }
    }
    return null;
  };

  const pendaftaran = grab([/\b1\s*\.\s*Pendaftaran\s*([0-9][0-9.]{0,20})/i, /\bPendaftaran\s*([0-9][0-9.]{0,20})/i], {min:100000});
  const dpp = grab([/\b2\s*[\.]\s*(?:Dana[\s\S]*?Pendidikan[\s\S]*?Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?[^0-9]{0,200}([0-9][0-9.\s]{0,60})/i, /(?:Dana[\s\S]*?Pendidikan[\s\S]*?Pokok|DanaPendidikanPokok)[^0-9]{0,200}([0-9][0-9.\s]{0,60})/i, /Dana\s*Pendidikan[^0-9]{0,200}([0-9][0-9.\s]{0,60})/i], {min:100000, max:250000000});
  const attr1 = grab([/Jas(?:\s+almamater)?[\s\S]{0,40}?([0-9][0-9.]{0,20})/i, /Jas almamater[^0-9]{0,40}([0-9][0-9.]{0,20})/i], {min:10000, max:2000000});
  const attr2 = grab([/Kaos[,\s]+tas[,\s]+GMTI[^0-9]{0,40}([0-9][0-9.]{0,20})/i, /Kaos[^0-9]{0,40}([0-9][0-9.]{0,20})/i], {min:10000, max:2000000});

  return { pendaftaran, dpp, atribut1: attr1, atribut2: attr2 };
}

function extractDppScholarshipsFromCorpus(corpus, markerRe) {
  const m = markerRe.exec(corpus);
  if (!m) return null;
  const start = Math.max(0, m.index);
  const section = corpus.slice(start, start + 200000);
  const beaIdx = section.search(/Beasiswa[\s\S]{0,60}(?:Dana\s*Pendidikan\s*Pokok|DPP|DanaPendidikanPokok)/i);
  if (beaIdx < 0) return null;
  let beaSection = section.slice(beaIdx, Math.min(section.length, beaIdx + 50000));
  const stopM = /(Bahasa\s+(?:Inggris|Mandarin)|Biaya\s*Pendidikan|Potongan\s*Biaya|Catatan|Keterangan)/i.exec(beaSection);
  if (stopM && stopM.index > 0) beaSection = beaSection.slice(0, stopM.index);

  const byWave = {};
  const regex = /Rp\.?\,?\s*([0-9][0-9.\s]{0,30})/gi;
  let match;
  while ((match = regex.exec(beaSection)) !== null) {
    const amountRaw = match[1] ? String(match[1]).trim() : '';
    if (!amountRaw) continue;
    const startCtx = Math.max(0, match.index - 140);
    const tail = beaSection.slice(startCtx, Math.min(beaSection.length, match.index + 140));
    const waveMatch = /Gelombang\s*(Khusus|[0-9IVX]+)/i.exec(tail) || /(Khusus|I|II|III|IV|V|VI|VII)/i.exec(tail);
    if (!waveMatch || !waveMatch[1]) continue;
    let wave = String(waveMatch[1]).trim();
    if (/khusus/i.test(wave)) wave = 'Khusus'; else wave = wave.toUpperCase();
    const amt = parseCompactRupiahNumber(amountRaw, {min:10000, max:250000000});
    if (!amt) continue;
    if (!byWave[wave]) byWave[wave] = amt;
  }
  return Object.keys(byWave).length ? { byWave } : null;
}

// Program markers copied from provider.js
const markers = {
  s1: /RINCIAN\s*BIAYA\s*PENDIDIKAN[\s\S]{0,1200}(?:KELAS\s*REGULER|KELASREGULER)[\s\S]{0,1200}(?:PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI)/i,
  sk: /RINCIAN\s*BIAYA\s*PENDIDIKAN[\s\S]{0,1200}(?:KELAS\s*REGULER|KELASREGULER)[\s\S]{0,1200}(?:PROGRAM\s*STUDI\s*SISTEM\s*KOMPUTER|PROGRAMSTUDISISTEMKOMPUTER)/i,
  d3: /RINCIAN\s*BIAYA\s*PENDIDIKAN[\s\S]{0,1200}(?:KELAS\s*REGULER|KELASREGULER)[\s\S]{0,2000}(?:PROGRAM\s*STUDI\s*MANAJEMEN\s*INFORMATIKA|MANAGEMENT\s*INFORMATIKA|INFORMATIC\s*DIPLOMA)/i,
  s2: /BIAYA\s*PENDIDIKAN\s*MAHASISWA\s*BARU\s*PASCASARJANA/i,
  utb: /DUAL\s*DEGREE[\s\S]{0,1200}(?:UNIVERSITAS\s*TEKNOLOGI\s*BANDUNG|\bUTB\b)/i,
  dnui: /DUAL\s*DEGREE[\s\S]{0,1200}(?:DALIAN\s+NEUSOFT[\s\S]{0,1200}\bDNUI\b|\bDNUI\b)/i,
  help: /DUAL\s*DEGREE[\s\S]{0,1200}HELP\s+UNIVERSITY/i
};

function showFor(programKey = 's1', wave = 'II') {
  const corpus = getBundledIndexCorpus();
  const marker = markers[programKey] || markers.s1;
  const feeSection = (marker.exec(corpus) ? corpus.slice(Math.max(0, marker.lastIndex - 1), Math.min(corpus.length, marker.lastIndex + 200000)) : null) || null;
  const basics = feeSection ? extractFeeBasicsFromSection(feeSection) : null;
  const dppTable = extractDppScholarshipsFromCorpus(corpus, marker);

  const pendaftaran = basics && basics.pendaftaran ? basics.pendaftaran : null;
  const dpp = basics && basics.dpp ? basics.dpp : null;
  const atribut1 = basics && basics.atribut1 ? basics.atribut1 : 0;
  const atribut2 = basics && basics.atribut2 ? basics.atribut2 : 0;

  const dppByWave = dppTable && dppTable.byWave ? dppTable.byWave : {};
  const dppDiscount = (dppByWave && Object.prototype.hasOwnProperty.call(dppByWave, wave)) ? dppByWave[wave] : 0;

  const subtotalAwal = (dpp || 0) + (atribut1 || 0) + (atribut2 || 0);
  const totalAfter = Math.max(0, subtotalAwal - dppDiscount);

  console.log(`Program: ${programKey.toUpperCase()} (marker: ${marker.toString()})`);
  console.log('Komponen yang terdeteksi:');
  console.log(`- Biaya pendaftaran: ${pendaftaran ? 'Rp ' + pendaftaran.toLocaleString() : '(tidak tercantum)'}`);
  console.log(`- DPP: ${dpp ? 'Rp ' + dpp.toLocaleString() : '(tidak tercantum)'}`);
  console.log(`- Atribut1: ${atribut1 ? 'Rp ' + atribut1.toLocaleString() : '0'}`);
  console.log(`- Atribut2: ${atribut2 ? 'Rp ' + atribut2.toLocaleString() : '0'}`);
  console.log(`Subtotal awal masuk: Rp ${subtotalAwal.toLocaleString()}`);
  console.log('');
  console.log('Potongan DPP yang terdeteksi per gelombang (dari korpus):');
  if (dppByWave && Object.keys(dppByWave).length) {
    for (const k of Object.keys(dppByWave)) console.log(`- Gelombang ${k}: Rp ${dppByWave[k].toLocaleString()}`);
  } else console.log('- (tidak ditemukan potongan DPP dalam korpus)');
  console.log('');
  console.log(`Potongan DPP untuk gelombang ${wave}: Rp ${dppDiscount.toLocaleString()}`);
  console.log(`Total akhir setelah potongan (Gelombang ${wave}): Rp ${totalAfter.toLocaleString()}`);
}

function formatRupiah(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return 'Rp 0';
  return 'Rp ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function buildBreakdownMessage(programDisplayName, programKey, waveOpt = 'I') {
  const corpus = getBundledIndexCorpus();
  const marker = markers[programKey] || markers.s1;
  const feeSection = (marker.exec(corpus) ? corpus.slice(Math.max(0, marker.lastIndex - 1), Math.min(corpus.length, marker.lastIndex + 200000)) : null) || null;
  const basics = feeSection ? extractFeeBasicsFromSection(feeSection) : null;
  const dppTable = extractDppScholarshipsFromCorpus(corpus, marker);

  const pendaftaranAmt = basics && basics.pendaftaran ? basics.pendaftaran : null;
  const dppAmt = basics && basics.dpp ? basics.dpp : null;
  const attr1 = basics && basics.atribut1 ? basics.atribut1 : 0;
  const attr2 = basics && basics.atribut2 ? basics.atribut2 : 0;

  const dppByWave = dppTable && dppTable.byWave ? dppTable.byWave : {};
  const dppDiscount = (dppByWave && Object.prototype.hasOwnProperty.call(dppByWave, waveOpt)) ? dppByWave[waveOpt] : 0;

  const subtotalAwal = (dppAmt || 0) + (attr1 || 0) + (attr2 || 0);
  const totalAfterInit = Math.max(0, subtotalAwal - dppDiscount);

  const p = programDisplayName || programKey;
  const waveLabel = waveOpt ? `Gelombang ${waveOpt}` : null;

  const lines = [];
  lines.push('Baik, kak. Terimakasih atas pertanyaannya.');
  lines.push('');
  lines.push(`Untuk program studi ${p}, rincian biaya sebagai berikut:`);
  lines.push('');

  // Pendaftaran
  lines.push('Pendaftaran:');
  if (pendaftaranAmt) {
    lines.push(`* Biaya pendaftaran: ${formatRupiah(pendaftaranAmt)}`);
  } else {
    lines.push(`* Biaya pendaftaran: (tidak tercantum)`);
  }
  let pendaftaranDiscount = 0;
  if (dppByWave && waveOpt && Object.prototype.hasOwnProperty.call(dppByWave, waveOpt)) {
    // Note: in provider.js pendaftaran discounts are separate; for this simplified script we keep 0
    pendaftaranDiscount = 0;
  }
  lines.push(`* Potongan biaya pendaftaran${waveLabel ? ` (${waveLabel})` : ''}: ${formatRupiah(pendaftaranDiscount)}`);
  if (pendaftaranAmt) {
    const pendaftaranTotal = Math.max(0, pendaftaranAmt - pendaftaranDiscount);
    lines.push(`Total biaya pendaftaran${waveLabel ? ` (${waveLabel})` : ''}: ${formatRupiah(pendaftaranTotal)}`);
  }

  lines.push('');

  // Biaya awal masuk
  lines.push(`Biaya awal masuk untuk Prodi ${p}:`);
  if (dppAmt) lines.push(`* DPP: ${formatRupiah(dppAmt)}`);
  if (attr1) {
    const label1 = 'Jas almamater dan topi';
    lines.push(`* ${label1}: ${formatRupiah(attr1)}`);
  }
  if (attr2) lines.push(`* Kaos, tas, GMTI: ${formatRupiah(attr2)}`);
  lines.push(`Subtotal biaya awal masuk: ${formatRupiah(subtotalAwal)}`);

  lines.push(`* Potongan biaya DPP${waveLabel ? ` (${waveLabel})` : ''}: ${formatRupiah(dppDiscount)}`);
  if (subtotalAwal) {
    lines.push(`Total biaya awal masuk setelah potongan${waveLabel ? ` (${waveLabel})` : ''}: ${formatRupiah(totalAfterInit)}`);
  }

  // Biaya per semester — mimic provider behavior
  const semAmt = basics && basics.biayaPendidikan ? basics.biayaPendidikan : null;
  if (semAmt) {
    const semLabel = 'Biaya pendidikan per semester (UKT)';
    lines.push('');
    lines.push(`${semLabel}: ${formatRupiah(semAmt)}`);
  }

  // Scholarship postamble (must match template)
  lines.push('');
  lines.push('Untuk meringankan biaya, tersedia berbagai macam beasiswa yang bisa dimanfaatkan sesuai syarat dan ketentuan yang berlaku termasuk:');
  lines.push('* Beasiswa KIP');
  lines.push('* Beasiswa 1K1S (Satu Keluarga Satu Sarjana)');
  lines.push('* Beasiswa Prestasi');
  lines.push('* Beasiswa Yayasan');
  lines.push('* Beasiswa Khusus Siswa SMKTI Bali Global dan SMK Pandawa Bali Global');
  lines.push('* Kuliah Sambil Kerja di Luar Negeri');
  lines.push('');
  lines.push('Apakah Kakak ingin dijelaskan tentang?');
  lines.push('* Biaya perkuliahan program studi yang lainnya');
  lines.push('* Salah satu jenis beasiswa');
  lines.push('* Fasilitas yang ada di ITB STIKOM Bali seperti Career Center, Inkubator Bisnis, Hi-Think (Program Persiapan Kerja di Bidang TI di Jepang) dll');
  lines.push('Silahkan diketikkan.');

  return lines.join('\n').trim();
}

const argv = process.argv.slice(2);
const programKey = argv[0] || 's1';
const wave = argv[1] || 'II';
showFor(programKey, wave);
// Print the exact 'breakdown' message template as the bot would send
const displayMap = { s1: 'Sistem Informasi', sk: 'Sistem Komputer', dnui: 'Dual Degree DNUI', help: 'Dual Degree HELP University' };
const programDisplay = argv[2] || displayMap[programKey] || programKey;
console.log('\n--- Generated bot message (breakdown template) ---\n');
console.log(buildBreakdownMessage(programDisplay, programKey, wave));
