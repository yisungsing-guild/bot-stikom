const fs = require('fs');
const path = require('path');

function parseCompactRupiahNumber(raw, opts = null) {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/\s+[0-9]{1,2}\s*[\.)][\s\S]*$/g, '');
  const m = /([0-9][0-9.,\s]{0,40})/.exec(s);
  const token = m && m[1] ? String(m[1]) : '';
  const digits = token.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = parseInt(digits, 10);
  if (!Number.isFinite(n)) return null;
  const o = (opts && typeof opts === 'object') ? opts : {};
  const min = Number.isFinite(o.min) ? o.min : 50000;
  const max = Number.isFinite(o.max) ? o.max : 50000000;
  if (n < min || n > max) return null;
  return n;
}

function formatRupiah(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return 'Rp 0';
  return 'Rp ' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function extractFeeBasicsFromSection(sectionText) {
  const section = String(sectionText || '').replace(/\\n/g, '\n').replace(/\s{2,}/g, ' ').trim();
  if (!section) return null;
  const grab = (res) => {
    for (const re of res) {
      const m = re.exec(section);
      if (m && m[1]) {
        const n = parseCompactRupiahNumber(m[1]);
        if (n) return n;
      }
    }
    return null;
  };

  const registrationFee = grab([
    /\b1\s*\.\s*Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i,
    /(?:^|[\r\n])\s*(?:Biaya\s+)?Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/im,
    /\bPendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i
  ]);

  const dpp = grab([
    /\b2\s*\.\s*(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i,
    /(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i
  ]);

  const uniformFee = grab([
    /\b3\s*\.\s*Jas[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bJas[^0-9]{0,80}(?:topi|cap|hat)[\s\S]{0,80}([0-9][0-9.]{0,20})/i,
    /\bJas\s+Almamater\s+(?:dan|&)\s+Topi[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bJas[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]);

  const capFee = grab([
    /\bTopi[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bCap[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]) || null;

  const shirtFee = grab([
    /\b4\s*\.\s*Kaos[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bKaos[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]);

  const gmtiFee = grab([
    /\bGMTI[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bGerakan\s+Mahasiswa\s+TI[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]) || null;

  const bagFee = grab([
    /\bTas[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bBag[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]) || null;

  const ukt = grab([
    /\b5\s*\.\s*(?:Biaya\s*Pendidikan\s*Per\s*Semester|BiayaPendidikanPerSemester)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i,
    /(?:Biaya\s*Pendidikan\s*Per\s*Semester|BiayaPendidikanPerSemester)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i
  ]);

  const atribut3 = grab([
    /Biaya\s*(?:Pengalaman\s*)?Industri[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /Biaya\s*Industri[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /Biaya\s*Magang[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /Praktikum[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]);

  const atribut1 = uniformFee;
  const atribut2 = shirtFee;

  const subtotalAwalMasuk = [registrationFee, dpp, uniformFee, capFee, shirtFee, gmtiFee, bagFee]
    .filter((v) => typeof v === 'number' && Number.isFinite(v))
    .reduce((acc, v) => acc + v, 0) || null;

  if (!registrationFee && !dpp && !ukt && !uniformFee && !capFee && !shirtFee && !gmtiFee && !bagFee) return null;

  return {
    registrationFee,
    dpp,
    uniformFee,
    capFee,
    shirtFee,
    gmtiFee,
    bagFee,
    ukt,
    subtotalAwalMasuk,
    pendaftaran: registrationFee,
    atribut1,
    atribut2,
    semester: ukt,
    totalAwalMasuk: subtotalAwalMasuk
  };
}

function takeAround(norm, markerRe, window = 120000, stopAfterRe = null) {
  const m = markerRe.exec(norm);
  if (!m) return null;
  const start = Math.max(0, m.index);
  let end = Math.min(norm.length, start + window);
  if (stopAfterRe) {
    const tail = norm.slice(start + m[0].length);
    const stopM = stopAfterRe.exec(tail);
    if (stopM && stopM.index >= 0) {
      end = Math.min(end, start + m[0].length + stopM.index);
    }
  }
  return norm.slice(start, end);
}

function buildBreakdownMessage(programLabel, programTable, opts = {}) {
  const lines = [];
  lines.push('Baik, kak. Terimakasih atas pertanyaannya.');
  lines.push('');
  lines.push(`Untuk program studi ${programLabel}, rincian biaya sebagai berikut:`);
  lines.push('');

  const registrationFee = programTable && (programTable.registrationFee || programTable.pendaftaran) ? (programTable.registrationFee || programTable.pendaftaran) : null;
  lines.push('Biaya Pendaftaran:');
  if (registrationFee) lines.push(`- Biaya Pendaftaran: ${formatRupiah(registrationFee)}`);
  else lines.push(`- Biaya Pendaftaran: (tidak tercantum)`);
  const registrationDiscount = 0;
  lines.push(`- Potongan Pendaftaran: ${formatRupiah(registrationDiscount)}`);
  let registrationTotal = 0;
  if (registrationFee) { registrationTotal = Math.max(0, registrationFee - registrationDiscount); lines.push(`- Total Pendaftaran: ${formatRupiah(registrationTotal)}`); }
  lines.push('');

  const dppAmt = programTable && (programTable.dpp || null);
  lines.push('DPP:');
  if (dppAmt) lines.push(`- DPP: ${formatRupiah(dppAmt)}`);
  else lines.push(`- DPP: (tidak tercantum)`);
  lines.push('');

  const uniformFee = programTable && (programTable.uniformFee || programTable.atribut1) ? (programTable.uniformFee || programTable.atribut1) : null;
  const capFee = programTable && programTable.capFee ? programTable.capFee : null;
  const shirtFee = programTable && (programTable.shirtFee || programTable.atribut2) ? (programTable.shirtFee || programTable.atribut2) : null;
  const gmtiFee = programTable && programTable.gmtiFee ? programTable.gmtiFee : null;
  const bagFee = programTable && programTable.bagFee ? programTable.bagFee : null;

  const hasUniformComponents = uniformFee || capFee || shirtFee || gmtiFee || bagFee;
  if (hasUniformComponents) {
    lines.push('Biaya Perlengkapan:');
    if (uniformFee) lines.push(`- Jas Almamater & Topi: ${formatRupiah(uniformFee)}`);
    if (capFee && capFee !== uniformFee) lines.push(`- Topi: ${formatRupiah(capFee)}`);
    if (shirtFee) lines.push(`- Kaos: ${formatRupiah(shirtFee)}`);
    if (gmtiFee) lines.push(`- GMTI: ${formatRupiah(gmtiFee)}`);
    if (bagFee) lines.push(`- Tas: ${formatRupiah(bagFee)}`);
    lines.push('');
  }

  const subtotalAwalMasuk = ((registrationFee || 0) + (dppAmt || 0) + (uniformFee || 0) + (capFee || 0) + (shirtFee || 0) + (gmtiFee || 0) + (bagFee || 0));
  lines.push(`Subtotal Awal Masuk: ${formatRupiah(subtotalAwalMasuk)}`);
  lines.push('');

  const dppDiscount = 0;
  lines.push(`Potongan DPP: ${formatRupiah(dppDiscount)}`);
  lines.push('');

  let totalBiayaMasuk = subtotalAwalMasuk;
  if (typeof registrationDiscount === 'number' && Number.isFinite(registrationDiscount) && registrationDiscount > 0) totalBiayaMasuk = Math.max(0, totalBiayaMasuk - registrationDiscount);
  if (typeof dppDiscount === 'number' && Number.isFinite(dppDiscount) && dppDiscount > 0) totalBiayaMasuk = Math.max(0, totalBiayaMasuk - dppDiscount);
  lines.push(`Total Biaya Masuk: ${formatRupiah(totalBiayaMasuk)}`);
  lines.push('');

  const ukt = programTable && (programTable.ukt || programTable.semester || programTable.biayaPendidikan) ? (programTable.ukt || programTable.semester || programTable.biayaPendidikan) : null;
  if (ukt) {
    const uktLabel = 'Biaya Pendidikan per Semester (UKT)';
    lines.push(`${uktLabel}: ${formatRupiah(ukt)}`);
    lines.push('');
  }

  lines.push('Untuk meringankan biaya, tersedia berbagai macam beasiswa yang bisa dimanfaatkan sesuai syarat dan ketentuan yang berlaku termasuk:');
  lines.push('* Beasiswa KIP');
  lines.push('* Beasiswa 1K1S (Satu Keluarga Satu Sarjana)');
  lines.push('* Beasiswa Prestasi');
  lines.push('* Beasiswa Yayasan');
  lines.push('* Beasiswa khusus untuk alumni — silakan hubungi PMB untuk detail');
  lines.push('* Kuliah Sambil Kerja di Luar Negeri');
  lines.push('');
  lines.push('Apakah Kakak ingin dijelaskan tentang?');
  lines.push('* Biaya perkuliahan program studi yang lainnya');
  lines.push('* Salah satu jenis beasiswa');
  lines.push('* Fasilitas yang ada di ITB STIKOM Bali seperti Career Center, Inkubator Bisnis, Hi-Think (Program Persiapan Kerja di Bidang TI di Jepang) dll');
  lines.push('Silahkan diketikkan.');

  return { message: lines.join('\n').trim(), fields: {
    registrationFee,
    registrationDiscount: 0,
    registrationTotal: registrationFee ? Math.max(0, registrationFee - 0) : 0,
    dpp: dppAmt,
    uniformFee,
    capFee,
    shirtFee,
    gmtiFee,
    bagFee,
    subtotalAwalMasuk,
    dppDiscount: 0,
    totalBiayaMasuk,
    ukt
  } };
}

function loadCorpus() {
  const p = path.join(__dirname, '..', 'src', 'data', 'rag_index.json');
  const raw = fs.readFileSync(p, 'utf-8');
  const norm = raw.replace(/\\n/g, '\n').replace(/\\r/g, '\n');
  return norm;
}

function extractAll() {
  const norm = loadCorpus();
  const markers = {
    s1: /RINCIAN\s*BIAYA\s*PENDIDIKAN[\s\S]{0,1200}(?:KELAS\s*REGULER|KELASREGULER)[\s\S]{0,1200}(?:PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI)/i,
    sk: /RINCIAN\s*BIAYA\s*PENDIDIKAN[\s\S]{0,1200}(?:KELAS\s*REGULER|KELASREGULER)[\s\S]{0,1200}(?:PROGRAM\s*STUDI\s*SISTEM\s*KOMPUTER|PROGRAMSTUDISISTEMKOMPUTER)/i,
    d3: /RINCIAN\s*BIAYA\s*PENDIDIKAN[\s\S]{0,1200}(?:KELAS\s*REGULER|KELASREGULER)[\s\S]{0,2000}(?:PROGRAM\s*STUDI\s*MANAJEMEN\s*INFORMATIKA|MANAGEMENT\s*INFORMATIKA|INFORMATIC\s*DIPLOMA)/i,
    s2: /BIAYA\s*PENDIDIKAN\s*MAHASISWA\s*BARU\s*PASCASARJANA/i,
    utb: /DUAL\s*DEGREE[\s\S]{0,1200}(?:UNIVERSITAS\s*TEKNOLOGI\s*BANDUNG|\bUTB\b)/i,
    dnui: /DUAL\s*DEGREE[\s\S]{0,1200}(?:DALIAN\s+NEUSOFT[\s\S]{0,1200}\bDNUI\b|\bDNUI\b)/i,
    help: /DUAL\s*DEGREE[\s\S]{0,1200}HELP\s+UNIVERSITY/i
  };

  const out = {};
  for (const k of Object.keys(markers)) {
    const sec = takeAround(norm, markers[k], 200000);
    out[k] = sec ? extractFeeBasicsFromSection(sec) : null;
  }
  return out;
}

function main() {
  const feeBasics = extractAll();
  const queries = [
    { label: 'Teknologi Informasi', key: 's1', wave: '2C' },
    { label: 'Sistem Informasi', key: 's1', wave: '2C' },
    { label: 'Sistem Komputer', key: 'sk', wave: '2C' },
    { label: 'D3 Manajemen Informatika', key: 'd3', wave: '2C' },
    { label: 'S2 Pascasarjana', key: 's2', wave: '2C' },
    { label: 'HELP University (Dual Degree)', key: 'help', wave: '2C' }
  ];

  for (const q of queries) {
    const table = feeBasics[q.key];
    const res = buildBreakdownMessage(q.label, table, { wave: q.wave });
    console.log('--- QUERY:', `berapa biaya ${q.label} gelombang ${q.wave}`);
    console.log('source file: src/data/rag_index.json');
    console.log('feeStruct:', JSON.stringify(res.fields, null, 2));
    console.log('FULL_FINAL_WA_MESSAGE:\n');
    console.log(res.message);
    console.log('\n\n');
  }
}

main();
