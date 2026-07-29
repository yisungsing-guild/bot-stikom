function formatRupiah(amount) {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return 'Rp. 0';
  return 'Rp. ' + Math.round(n).toLocaleString('id-ID');
}

function buildCanonicalFeeTemplate(fs, opts) {
  const o = opts || {};
  const programLabel = o.program || fs.program || fs.programLabel || 'Tidak tersedia';
  const waveLabel = o.wave || fs.gelombang || fs.wave || '';
  const waveSuffix = waveLabel ? ` (${waveLabel})` : '';

  const reg = fs.registrationFee || fs.biayaPendaftaran || null;
  const regDisc = fs.registrationDiscount || fs.potonganPendaftaran || null;
  const dpp = fs.dpp || fs.biayaPendidikanAwal || null;
  const dppDiscount = fs.dppDiscount || fs.potonganDpp || fs.dppPotongan || 0;
  const ukt = fs.ukt || fs.semester || fs.biayaPendidikan || null;

  const perlengkapanItems = [];
  const uniformFee = fs.uniformFee || fs.atribut1 || null;
  const shirtFee = fs.shirtFee || fs.atribut2 || null;
  const capFee = fs.capFee || null;
  const gmtiFee = fs.gmtiFee || null;
  const bagFee = fs.bagFee || null;
  const isCombinedKaosTasGmti = shirtFee && gmtiFee && bagFee && gmtiFee === shirtFee && bagFee === shirtFee;
  if (uniformFee) perlengkapanItems.push({ label: 'Jas almamater dan topi', amount: uniformFee });
  if (capFee && capFee !== uniformFee) perlengkapanItems.push({ label: 'Topi', amount: capFee });
  if (shirtFee) {
    if (isCombinedKaosTasGmti) {
      perlengkapanItems.push({ label: 'Kaos, tas, GMTI', amount: shirtFee });
    } else {
      perlengkapanItems.push({ label: 'Kaos', amount: shirtFee });
    }
  }
  if (!isCombinedKaosTasGmti && gmtiFee && gmtiFee !== shirtFee && gmtiFee !== uniformFee && gmtiFee !== capFee) perlengkapanItems.push({ label: 'GMTI', amount: gmtiFee });
  if (!isCombinedKaosTasGmti && bagFee && bagFee !== shirtFee && bagFee !== uniformFee && bagFee !== capFee && bagFee !== gmtiFee) perlengkapanItems.push({ label: 'Tas', amount: bagFee });

  const totalPerlengkapan = perlengkapanItems.reduce((sum, item) => sum + (item && typeof item.amount === 'number' ? item.amount : 0), 0);
  const totalAwalMasuk = Math.max(0,
    (typeof reg === 'number' ? reg : 0) - (typeof regDisc === 'number' ? regDisc : 0) +
    (typeof dpp === 'number' ? dpp : 0) - (typeof dppDiscount === 'number' ? dppDiscount : 0) +
    totalPerlengkapan
  );

  const lines = [];
  lines.push(`Program Studi: ${programLabel}${waveLabel ? ' — Gelombang ' + waveLabel : ''}`);
  lines.push('');
  lines.push('Rincian Biaya:');
  lines.push('');

  lines.push('Pendaftaran:');
  lines.push(`- Biaya pendaftaran: ${reg ? formatRupiah(reg) : '(tidak tercantum)'}`);
  lines.push(`- Potongan biaya pendaftaran${waveSuffix}: ${regDisc ? formatRupiah(regDisc) : '(tidak tercantum)'}`);
  if (reg !== null) {
    const totalReg = (typeof reg === 'number' ? reg : 0) - (typeof regDisc === 'number' ? regDisc : 0);
    lines.push('');
    lines.push(`Total biaya pendaftaran${waveSuffix}: ${formatRupiah(totalReg)}`);
  }

  lines.push('');
  lines.push(`Biaya awal masuk untuk Prodi ${programLabel}:`);
  if (perlengkapanItems.length) {
    for (const item of perlengkapanItems) {
      lines.push(`- ${item.label}: ${formatRupiah(item.amount)}`);
    }
  } else {
    lines.push('- (tidak tercantum)');
  }

  lines.push('');
  lines.push(`Subtotal biaya awal masuk: ${formatRupiah(totalPerlengkapan)}`);
  lines.push('');
  lines.push(`- DPP: ${dpp ? formatRupiah(dpp) : '(tidak tercantum)'}`);
  lines.push(`- Potongan biaya DPP${waveSuffix}: ${formatRupiah(dppDiscount)}`);
  lines.push('');
  lines.push(`Total awal masuk setelah potongan${waveSuffix}: ${formatRupiah(totalAwalMasuk)}`);

  if (ukt !== null) {
    lines.push('');
    lines.push(`Biaya pendidikan per semester (UKT): ${formatRupiah(ukt)}`);
  }

  return lines.join('\n');
}

module.exports = { buildCanonicalFeeTemplate, formatRupiah };
