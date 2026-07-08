#!/usr/bin/env node
/**
 * Test fee parser dan formatter dengan sample section dari dokumen
 */

// Mock sample section untuk S1
const sampleS1Section = `
RINCIAN BIAYA PENDIDIKAN KELAS REGULER PROGRAM STUDI SISTEM INFORMASI

1. Pendaftaran: 500.000
2. Dana Pendidikan Pokok (DPP): 2.500.000
3. Jas almamater dan topi: 350.000
4. Kaos, tas, GMTI: 450.000
5. Biaya Pendidikan Per Semester: 1.750.000
`;

// Fungsi helper parsing numbers
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
  const min = Number.isFinite(o.min) ? o.min : 50_000;
  const max = Number.isFinite(o.max) ? o.max : 50_000_000;
  if (n < min || n > max) return null;

  return n;
}

// Refactored extractFeeBasicsFromSection
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

  // Registration fee
  const registrationFee = grab([
    /\b1\s*\.\s*Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i,
    /(?:^|[\r\n])\s*(?:Biaya\s+)?Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/im,
    /\bPendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i
  ]);

  // DPP
  const dpp = grab([
    /\b2\s*\.\s*(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i,
    /(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i
  ]);

  // Uniform components
  const uniformFee = grab([
    /\b3\s*\.\s*Jas[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bJas\s+Almamater\s+(?:dan|&)\s+Topi[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bJas[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]);

  const capFee = grab([
    /\bTopi[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bCap[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]) || null;

  // Shirt
  const shirtFee = grab([
    /\b4\s*\.\s*Kaos[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bKaos[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]);

  // GMTI
  const gmtiFee = grab([
    /\bGMTI[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bGerakan\s+Mahasiswa\s+TI[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]) || null;

  // Bag
  const bagFee = grab([
    /\bTas[^0-9]{0,80}([0-9][0-9.]{0,20})/i,
    /\bBag[^0-9]{0,80}([0-9][0-9.]{0,20})/i
  ]) || null;

  // UKT
  const ukt = grab([
    /\b5\s*\.\s*(?:Biaya\s*Pendidikan\s*Per\s*Semester|BiayaPendidikanPerSemester)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i,
    /(?:Biaya\s*Pendidikan\s*Per\s*Semester|BiayaPendidikanPerSemester)\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i
  ]);

  // Backward compatibility
  const atribut1 = uniformFee;
  const atribut2 = shirtFee;

  // Calculate subtotal
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
    // Backward compatibility
    pendaftaran: registrationFee,
    atribut1,
    atribut2,
    semester: ukt,
    totalAwalMasuk: subtotalAwalMasuk
  };
}

// Test
console.log('===== TEST PARSER =====\n');
const result = extractFeeBasicsFromSection(sampleS1Section);
console.log('Parsed result:');
console.log(JSON.stringify(result, null, 2));

console.log('\n===== TEST FORMATTER OUTPUT =====\n');

function formatRupiah(num) {
  if (typeof num !== 'number' || !Number.isFinite(num)) return '0';
  return 'Rp ' + num.toLocaleString('id-ID');
}

function buildFormattedOutput(result, program = 'Sistem Informasi', wave = 'I') {
  const lines = [];
  
  lines.push('Baik, kak. Terimakasih atas pertanyaannya.');
  lines.push('');
  lines.push(`Untuk program studi ${program}, rincian biaya sebagai berikut:`);
  lines.push('');

  // 1. BIAYA PENDAFTARAN
  lines.push('Biaya Pendaftaran:');
  if (result.registrationFee) {
    lines.push(`- Biaya Pendaftaran: ${formatRupiah(result.registrationFee)}`);
  } else {
    lines.push(`- Biaya Pendaftaran: (tidak tercantum)`);
  }
  lines.push(`- Potongan Pendaftaran (Gelombang ${wave}): ${formatRupiah(0)}`);
  if (result.registrationFee) {
    const total = Math.max(0, result.registrationFee - 0);
    lines.push(`- Total Pendaftaran (Gelombang ${wave}): ${formatRupiah(total)}`);
  }
  lines.push('');

  // 2. DPP
  lines.push('DPP:');
  if (result.dpp) {
    lines.push(`- DPP: ${formatRupiah(result.dpp)}`);
  } else {
    lines.push(`- DPP: (tidak tercantum)`);
  }
  lines.push('');

  // 3. BIAYA PERLENGKAPAN
  const hasUniform = result.uniformFee || result.capFee || result.shirtFee || result.gmtiFee || result.bagFee;
  if (hasUniform) {
    lines.push('Biaya Perlengkapan:');
    if (result.uniformFee) lines.push(`- Jas Almamater & Topi: ${formatRupiah(result.uniformFee)}`);
    if (result.capFee && result.capFee !== result.uniformFee) lines.push(`- Topi: ${formatRupiah(result.capFee)}`);
    if (result.shirtFee) lines.push(`- Kaos: ${formatRupiah(result.shirtFee)}`);
    if (result.gmtiFee) lines.push(`- GMTI: ${formatRupiah(result.gmtiFee)}`);
    if (result.bagFee) lines.push(`- Tas: ${formatRupiah(result.bagFee)}`);
    lines.push('');
  }

  // 4. SUBTOTAL
  lines.push(`Subtotal Awal Masuk: ${formatRupiah(result.subtotalAwalMasuk)}`);
  lines.push('');

  // 5. POTONGAN DPP
  lines.push(`Potongan DPP (Gelombang ${wave}): ${formatRupiah(0)}`);
  lines.push('');

  // 6. TOTAL BIAYA MASUK
  const total = Math.max(0, result.subtotalAwalMasuk - 0 - 0);
  lines.push(`Total Biaya Masuk (Gelombang ${wave}): ${formatRupiah(total)}`);
  lines.push('');

  // 7. UKT
  if (result.ukt) {
    lines.push(`Biaya Pendidikan per Semester (UKT): ${formatRupiah(result.ukt)}`);
  }

  return lines.join('\n').trim();
}

const output = buildFormattedOutput(result);
console.log(output);

console.log('\n===== END TEST =====');
