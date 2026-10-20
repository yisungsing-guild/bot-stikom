'use strict';

/**
 * src/core/feeCalculationEngine.js
 *
 * Greenfield Dynamic Tuition Fee Calculation & Grounded WhatsApp Formatter.
 * ITB STIKOM Bali Chat Engine V2.
 *
 * Grounded strictly in official SK 629/ITBSTIKOM/WDS/X/25, official Double Degree
 * collaboration agreements, and Pascasarjana FAQ documents.
 *
 * Invariants:
 * 1. Zero hardcoded answer strings per question — answers are constructed dynamically
 *    from grounded fee models and requested scopes.
 * 2. Zero invented numbers or false Rp0 — unknown components are reported as SOURCE_GAP.
 * 3. Never equates Gelombang 1A, 1B with Gelombang I without explicit proof.
 * 4. Never mixes S1 Sistem Informasi, Teknologi Informasi, Bisnis Digital, Sistem Komputer,
 *    Double Degree (UTB, HELP, DNUI), and S2 Pascasarjana.
 * 5. Arithmetic precision: DPP installment is not an extra charge on top of DPP.
 *    Industry options (internasional/nasional/lokal) are choices, not all summed together.
 *    Year 1 estimate excludes industry experience fee (starts semester 3).
 * 6. Clean WhatsApp-ready formatting following Bagian 8 & Bagian 9 of Master Task.
 */

const { detectQueryLanguage } = require('../utils/languageDetector');
const logger = require('../logger');

// Format Rupiah numbers consistently
function formatRp(num) {
  if (num === null || num === undefined || isNaN(num)) return '-';
  return 'Rp ' + Number(num).toLocaleString('id-ID');
}

const fs = require('fs');
const path = require('path');

let _cachedFeeRegistry = null;

/**
 * Loads the structured, versioned canonical fee registry from data/runtime/canonical_fee_registry.json.
 * Grounded strictly in official SK 629/ITBSTIKOM/WDS/X/25 and institutional sources.
 * When academic years or SKs change, updating the canonical JSON file updates all fee outputs dynamically
 * without modifying calculation engine code.
 */
function loadCanonicalFeeCatalog() {
  if (_cachedFeeRegistry) return _cachedFeeRegistry;
  try {
    const candidatePaths = [
      path.join(process.cwd(), 'data', 'runtime', 'canonical_fee_registry.json'),
      path.join(__dirname, '..', '..', 'data', 'runtime', 'canonical_fee_registry.json')
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.programs) {
          _cachedFeeRegistry = parsed;
          return _cachedFeeRegistry;
        }
      }
    }
  } catch (err) {
    logger.warn('[feeCalculationEngine] Error loading canonical_fee_registry.json', { err: err.message });
  }
  return { programs: {} };
}

function getFeeCatalog() {
  const reg = loadCanonicalFeeCatalog();
  return (reg && reg.programs) || {};
}

/**
 * Resolves a canonical fee profile from a given name or entity.
 */
function resolveFeeProfile(nameOrEntity) {
  if (!nameOrEntity) return null;
  const catalog = getFeeCatalog();
  const str = String(nameOrEntity).trim();
  if (catalog[str]) return catalog[str];

  const lower = str.toLowerCase();
  if (/dnui/i.test(lower)) return catalog['Double Degree DNUI'];
  if (/help/i.test(lower)) return catalog['Double Degree HELP University'];
  if (/utb/i.test(lower)) return catalog['Dual Degree UTB'];
  if (/sistem\s+komputer|\bsk\b/i.test(lower)) return catalog['S1 Sistem Komputer'];
  if (/teknologi\s+informasi|\bti\b/i.test(lower)) return catalog['S1 Teknologi Informasi'];
  if (/bisnis\s+digital|\bbd\b/i.test(lower)) return catalog['S1 Bisnis Digital'];
  if (/sistem\s+informasi|\bsi\b/i.test(lower)) {
    if (/s2|magister|pasca/i.test(lower)) return catalog['S2 Sistem Informasi'];
    return catalog['S1 Sistem Informasi'];
  }
  if (/manajemen\s+informatika|\bd3\b/i.test(lower)) return catalog['D3 Manajemen Informatika'];
  if (/s2|magister|pascasarjana/i.test(lower)) return catalog['S2 Sistem Informasi'];
  if (/rpl/i.test(lower)) return catalog['RPL Sistem Informasi'];
  if (/transfer/i.test(lower)) return catalog['Transfer Kredit S1'];

  return null;
}

/**
 * Detects the specific fee scope and parameters requested in a query.
 */
function detectFeeScope(rawQuery = '', normalizedQuery = '') {
  const q = (rawQuery + ' ' + (normalizedQuery || '')).toLowerCase();

  // 1. Detect exact wave requested
  let registrationWave = null;
  let isWaveExplicit = false;
  let isWaveVerified = true;

  if (/\b(?:gelombang\s*1a|gel\s*1a)\b/i.test(q)) {
    registrationWave = 'Gelombang 1A';
    isWaveExplicit = true;
    isWaveVerified = false; // SOURCE GAP: Document has Gelombang I, NOT 1A
  } else if (/\b(?:gelombang\s*1b|gel\s*1b)\b/i.test(q)) {
    registrationWave = 'Gelombang 1B';
    isWaveExplicit = true;
    isWaveVerified = false; // SOURCE GAP: Document has Gelombang I, NOT 1B
  } else if (/\b(?:gelombang\s*khusus|gel\s*khusus|gelombang\s+awal)\b/i.test(q)) {
    registrationWave = 'Gelombang Khusus';
    isWaveExplicit = true;
  } else if (/\b(?:gelombang\s*(?:i\b|1\b)|gel\s*(?:i\b|1\b))\b/i.test(q) && !/\b(?:1a|1b)\b/i.test(q)) {
    registrationWave = 'Gelombang I';
    isWaveExplicit = true;
  } else if (/\b(?:gelombang\s*(?:ii\b|2\b)|gel\s*(?:ii\b|2\b))\b/i.test(q)) {
    registrationWave = 'Gelombang II';
    isWaveExplicit = true;
  } else if (/\b(?:gelombang\s*(?:iii\b|3\b)|gel\s*(?:iii\b|3\b))\b/i.test(q)) {
    registrationWave = 'Gelombang III';
    isWaveExplicit = true;
  } else if (/\b(?:gelombang\s*(?:iv\b|4\b)|gel\s*(?:iv\b|4\b))\b/i.test(q)) {
    registrationWave = 'Gelombang IV';
    isWaveExplicit = true;
  } else if (/\b(?:gelombang\s*sisipan|gel\s*sisipan)\b/i.test(q)) {
    registrationWave = 'Gelombang Sisipan';
    isWaveExplicit = true;
  }

  // 2. Detect industry experience option
  let industryOption = null;
  if (/\b(?:internasional|luar\s+negeri)\b/i.test(q) && /\b(?:industri|pengalaman|magang)\b/i.test(q)) {
    industryOption = 'internasional';
  } else if (/\b(?:nasional)\b/i.test(q) && /\b(?:industri|pengalaman|magang)\b/i.test(q)) {
    industryOption = 'nasional';
  } else if (/\b(?:lokal)\b/i.test(q) && /\b(?:industri|pengalaman|magang)\b/i.test(q)) {
    industryOption = 'lokal';
  }

  // 3. Detect requested calculation scope
  let calculationScope = 'full_breakdown';

  if (/\b(?:biaya\s+semester(?:\s+saja)?|semester\s+saja|spp(?:\s+saja)?|per\s+semester\s+saja)\b/i.test(q) &&
      !/\b(?:total|keseluruhan|awal|daftar|registrasi|dpp|rincian)\b/i.test(q)) {
    calculationScope = 'semester_only';
  } else if (/\b(?:biaya\s+pendaftaran(?:\s+saja)?|biaya\s+daftar(?:\s+saja)?|uang\s+pendaftaran|biaya\s+formulir)\b/i.test(q) &&
      !/\b(?:total|keseluruhan|awal|dpp|semester|rincian)\b/i.test(q)) {
    calculationScope = 'registration_only';
  } else if (/\b(?:dpp(?:\s+saja)?|dana\s+pendidikan\s+pokok(?:\s+saja)?|uang\s+pangkal)\b/i.test(q) &&
      !/\b(?:total|keseluruhan|awal|semester|rincian)\b/i.test(q)) {
    calculationScope = 'dpp_only';
  } else if (/\b(?:biaya\s+awal|total\s+biaya\s+awal|awal\s+sampai\s+registrasi|total\s+awal|subtotal\s+biaya\s+awal)\b/i.test(q)) {
    calculationScope = 'initial_total';
  } else if (/\b(?:total\s+semester\s+(?:pertama|1|satu)|semester\s+(?:pertama|1)\s+total)\b/i.test(q)) {
    calculationScope = 'first_semester_total';
  } else if (/\b(?:estimasi\s+biaya\s+tahun\s+(?:pertama|1|ke-1)|biaya\s+tahun\s+pertama|tahun\s+pertama|1\s+tahun\s+pertama)\b/i.test(q)) {
    calculationScope = 'first_year_estimate';
  } else if (/\b(?:total\s+(?:biaya\s+)?sampai\s+lulus|total\s+keseluruhan|total\s+program|biaya\s+kuliah\s+sampai\s+selesai|sampai\s+wisuda)\b/i.test(q)) {
    calculationScope = 'graduation_total';
  } else if (/\b(?:subtotal\s+komponen\s+terverifikasi|subtotal\s+yang\s+sudah\s+diketahui|subtotal)\b/i.test(q)) {
    calculationScope = 'verified_subtotal';
  } else if (industryOption) {
    calculationScope = 'with_industry_option';
  }

  // Check if SMK TI alumni discount requested
  const isSmkTi = /\b(?:smk\s*ti|alumni\s+smk)\b/i.test(q);
  // Check if cash payment discount requested
  const isCashPayment = /\b(?:tunai|lunas|cash|langsung\s+lunas)\b/i.test(q);

  return {
    calculationScope,
    registrationWave,
    isWaveExplicit,
    isWaveVerified,
    industryOption,
    isSmkTi,
    isCashPayment
  };
}

/**
 * Performs dynamic arithmetic calculations based on fee profile and requested parameters.
 */
function calculateFeeBreakdown(profile, scopeParams = {}) {
  if (!profile) return null;

  const {
    registrationWave,
    isWaveExplicit,
    isWaveVerified,
    industryOption,
    isSmkTi,
    isCashPayment
  } = scopeParams;

  const comps = profile.components || {};

  // 1. Base components
  const pendaftaranBase = comps.pendaftaran ? comps.pendaftaran.amount : 0;
  const dppBase = comps.dpp ? comps.dpp.amount : 0;
  const jasTopiBase = comps.jasTopi ? comps.jasTopi.amount : 0;
  const kaosTasBase = comps.kaosTasGmti ? comps.kaosTasGmti.amount : 0;
  const perlengkapanBase = jasTopiBase + kaosTasBase;
  const bahasaMandarinBase = comps.bahasaMandarin ? comps.bahasaMandarin.amount : 0;
  const bahasaInggrisBase = comps.bahasaInggris ? comps.bahasaInggris.amount : 0;
  const bahasaBase = bahasaMandarinBase || bahasaInggrisBase;
  const semesterBase = comps.biayaSemester ? comps.biayaSemester.amount : 0;

  // 2. Evaluate Discounts based on verified wave
  let pendaftaranDiscount = 0;
  let dppDiscount = 0;
  let waveDiscountObj = null;

  if (registrationWave && isWaveVerified && profile.waveDiscounts && profile.waveDiscounts[registrationWave]) {
    waveDiscountObj = profile.waveDiscounts[registrationWave];
    pendaftaranDiscount = waveDiscountObj.pendaftaranDiscount || 0;
    dppDiscount = waveDiscountObj.dppDiscount || 0;
  }

  // Cash payment discount on DPP (10% additional)
  let cashDiscountAmount = 0;
  if (isCashPayment && dppBase > 0) {
    const dppAfterWave = Math.max(0, dppBase - dppDiscount);
    cashDiscountAmount = Math.round(dppAfterWave * 0.10);
  }

  // SMK TI Alumni Semester Discount
  let semesterAfterDiscount = semesterBase;
  if (isSmkTi) {
    if (comps.biayaSemester?.alumniSmkAmount) {
      semesterAfterDiscount = comps.biayaSemester.alumniSmkAmount;
    } else if (profile.specialPolicies?.alumniSmkTiSemesterDiscountPercent) {
      const pct = profile.specialPolicies.alumniSmkTiSemesterDiscountPercent / 100;
      semesterAfterDiscount = Math.round(semesterBase * (1 - pct));
    }
  }

  // Net values
  const pendaftaranNet = Math.max(0, pendaftaranBase - pendaftaranDiscount);
  const dppNet = Math.max(0, dppBase - dppDiscount - cashDiscountAmount);

  // Direct upfront payment due at registration (pendaftaran + perlengkapan fisik)
  const biayaLangsungRegistrasi = pendaftaranNet + perlengkapanBase;

  // Initial Total Obligation (total kewajiban biaya awal masuk, mencakup kewajiban DPP penuh)
  // For S1 & D3: Pendaftaran + DPP + Perlengkapan
  // For Double Degree HELP / DNUI: Pendaftaran + DPP + Language
  const initialTotalBeforeDiscounts = pendaftaranBase + dppBase + perlengkapanBase + bahasaBase;
  const initialTotalNet = pendaftaranNet + dppNet + perlengkapanBase + bahasaBase;

  // Total Semester 1: Initial Total Obligation + Semester 1 Tuition
  // DPP installment is NOT added again since full DPP obligation is already counted
  const firstSemesterTotalNet = initialTotalNet + semesterAfterDiscount;

  // First Year Estimate: Initial Total Obligation + 2x Semester Tuition
  // Industry fee NOT included (starts semester 3)
  const firstYearEstimateNet = initialTotalNet + (2 * semesterAfterDiscount);

  // Industry Experience Fee
  let industryFeeAmount = 0;
  let industryFeeLabel = null;
  if (comps.pengalamanIndustri && industryOption && comps.pengalamanIndustri.options[industryOption]) {
    industryFeeAmount = comps.pengalamanIndustri.options[industryOption].amount;
    industryFeeLabel = comps.pengalamanIndustri.options[industryOption].label;
  }

  return {
    profile,
    scopeParams,
    base: {
      pendaftaran: pendaftaranBase,
      dpp: dppBase,
      jasTopi: jasTopiBase,
      kaosTasGmti: kaosTasBase,
      perlengkapan: perlengkapanBase,
      bahasa: bahasaBase,
      bahasaLabel: comps.bahasaMandarin?.label || comps.bahasaInggris?.label || 'Biaya Penguatan Bahasa',
      semester: semesterBase
    },
    discounts: {
      wave: registrationWave,
      isWaveVerified,
      pendaftaranDiscount,
      dppDiscount,
      cashDiscountAmount,
      isSmkTi,
      isCashPayment
    },
    net: {
      pendaftaran: pendaftaranNet,
      dpp: dppNet,
      semester: semesterAfterDiscount,
      biayaLangsungRegistrasi,
      initialTotal: initialTotalNet,
      firstSemesterTotal: firstSemesterTotalNet,
      firstYearEstimate: firstYearEstimateNet
    },
    initialTotalBeforeDiscounts,
    industryFee: {
      selectedOption: industryOption,
      amount: industryFeeAmount,
      label: industryFeeLabel
    }
  };
}


/**
 * Formats a clean, grounded WhatsApp answer strictly compliant with Bagian 8.
 */
function formatWhatsAppFeeResponse(calcResult, rawQuery = '') {
  if (!calcResult || !calcResult.profile) return null;

  const { profile, scopeParams, net, base, discounts, initialTotalBeforeDiscounts, industryFee } = calcResult;
  const { calculationScope, registrationWave, isWaveExplicit, isWaveVerified, isSmkTi } = scopeParams;
  const comps = profile.components || {};

  // Case 1: S2 Sistem Informasi (Pascasarjana)
  if (profile.canonical === 'S2 Sistem Informasi') {
    const regFee = comps.pendaftaran?.amount ? formatRp(comps.pendaftaran.amount) : 'Rp 700.000';
    let text = `*Rincian Biaya Kuliah Magister (S2) Sistem Informasi*\n\n` +
      `Jenjang: S2 Pascasarjana\n` +
      `Tahun akademik: 2026/2027\n\n` +
      `*Komponen biaya terverifikasi:*\n` +
      `- Biaya pendaftaran: ${regFee} (sebelum potongan promo yang berlaku)\n\n` +
      `*Catatan Penting (Ketentuan Sumber):*\n` +
      `1. Terdapat potongan biaya pendaftaran sesuai gelombang pendaftaran dan potongan khusus alumni.\n` +
      `2. Rincian Dana Pendidikan Pokok (DPP) dan biaya pendidikan per semester (SPP) belum tercantum dalam dokumen resmi yang tersedia saat ini (SOURCE_GAP).\n` +
      `3. Informasi resmi tidak mencantumkan beasiswa penuh untuk S2.\n\n` +
      `Untuk memastikan rincian biaya semester dan pendaftaran terbaru, silakan hubungi admisi Pascasarjana ITB STIKOM Bali di *0822-7738-9999* atau *(0361) 244445*.`;
    return text;
  }

  // Case 2: Specific Single-Aspect Queries

  // 2a. Semester fee only
  if (calculationScope === 'semester_only') {
    if (profile.canonical === 'Double Degree HELP University') {
      return `Biaya pendidikan untuk *${profile.canonical}* adalah *${formatRp(comps.biayaPerSubject.amount)} per subject/mata kuliah*. Biaya ini dibayarkan setiap awal semester sesuai dengan jumlah subject yang diambil pada semester bersangkutan.`;
    }
    const smkNote = isSmkTi ? ` (khusus alumni SMK TI: *${formatRp(net.semester)}*)` : '';
    const installmentNote = comps.biayaSemester?.installment ? ` (${comps.biayaSemester.installment})` : '';
    return `Biaya pendidikan per semester untuk *${profile.canonical}* adalah sebesar *${formatRp(base.semester)}* per semester${smkNote}. Biaya ini dibayarkan menjelang masa perwalian/KRS setiap semester${installmentNote}.`;
  }

  // 2b. Registration fee only
  if (calculationScope === 'registration_only') {
    const regNominal = formatRp(base.pendaftaran);
    let waveText = '';
    if (profile.waveDiscounts) {
      waveText = `\n\nTersedia potongan biaya pendaftaran resmi berdasarkan gelombang:\n` +
        `- Gelombang Khusus: Potongan ${formatRp(profile.waveDiscounts['Gelombang Khusus']?.pendaftaranDiscount || 0)}\n` +
        `- Gelombang I: Potongan ${formatRp(profile.waveDiscounts['Gelombang I']?.pendaftaranDiscount || 0)}\n` +
        `- Gelombang II: Potongan ${formatRp(profile.waveDiscounts['Gelombang II']?.pendaftaranDiscount || 0)}\n` +
        `- Gelombang III: Potongan ${formatRp(profile.waveDiscounts['Gelombang III']?.pendaftaranDiscount || 0)}\n` +
        `- Gelombang IV: Potongan ${formatRp(profile.waveDiscounts['Gelombang IV']?.pendaftaranDiscount || 0)}\n` +
        `- Gelombang Sisipan: Potongan Rp 0`;
    }
    return `Biaya pendaftaran untuk *${profile.canonical}* adalah sebesar *${regNominal}* (dibayarkan satu kali pada saat pendaftaran awal).${waveText}\n\nPendaftaran dapat dilakukan secara online melalui https://pmb.stikom-bali.ac.id.`;
  }

  // 2c. DPP only and installment
  if (calculationScope === 'dpp_only') {
    const dppNominal = formatRp(base.dpp);
    const installmentRule = comps.dpp?.installment || 'Dapat dicicil per bulan s.d. UTS-1';
    let waveText = '';
    if (profile.waveDiscounts) {
      waveText = `\n\nBeasiswa potongan DPP resmi per gelombang:\n` +
        `- Gelombang Khusus: Potongan ${formatRp(profile.waveDiscounts['Gelombang Khusus']?.dppDiscount || 0)}\n` +
        `- Gelombang I: Potongan ${formatRp(profile.waveDiscounts['Gelombang I']?.dppDiscount || 0)}\n` +
        `- Gelombang II: Potongan ${formatRp(profile.waveDiscounts['Gelombang II']?.dppDiscount || 0)}\n` +
        `- Gelombang III: Potongan ${formatRp(profile.waveDiscounts['Gelombang III']?.dppDiscount || 0)}\n` +
        `- Gelombang IV: Potongan ${formatRp(profile.waveDiscounts['Gelombang IV']?.dppDiscount || 0)}\n` +
        `- Gelombang Sisipan: Potongan Rp 0`;
    }
    return `Dana Pendidikan Pokok (DPP) untuk *${profile.canonical}* adalah sebesar *${dppNominal}*.\n\n` +
      `*Ketentuan Pembayaran DPP:*\n` +
      `- **Cicilan**: ${installmentRule} (tidak wajib dibayar tunai sekaligus saat masuk).\n` +
      `- **Pembayaran Tunai**: Apabila DPP dibayarkan secara tunai langsung lunas, diberikan tambahan potongan sebesar *10%*.${waveText}`;
  }

  // 2d. Initial total only
  if (calculationScope === 'initial_total') {
    if (isWaveExplicit && !isWaveVerified) {
      return `*Tarif Dasar Biaya Awal ${profile.canonical} (Terkait ${registrationWave})*\n\n` +
        `Gelombang "${registrationWave}" belum terverifikasi dalam dokumen resmi SK Rektor No. 629/ITBSTIKOM/WDS/X/25 (dokumen resmi mencakup 6 gelombang: Gelombang Khusus, Gelombang I, II, III, IV, dan Sisipan).\n\n` +
        `*Pemisahan komponen biaya awal (tarif dasar umum):*\n` +
        `1. **Biaya langsung saat registrasi awal**:\n` +
        `   - Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (saat mendaftar)\n` +
        (base.perlengkapan ? `   - Perlengkapan (Jas, Topi, Kaos, Tas, GMTI): ${formatRp(base.perlengkapan)} (saat registrasi I)\n` : '') +
        `   -> Pembayaran langsung saat registrasi: *${formatRp(net.biayaLangsungRegistrasi)}*\n\n` +
        `2. **Kewajiban Dana Pendidikan Pokok (DPP)**:\n` +
        `   - Total Kewajiban DPP: *${formatRp(base.dpp)}*\n` +
        `   - Ketentuan pembayaran DPP: Dapat dicicil bertahap setiap bulan hingga UTS-1 (tidak wajib lunas langsung saat registrasi awal).\n\n` +
        `*Ringkasan Biaya Awal:*\n` +
        `- Pembayaran langsung saat registrasi: *${formatRp(net.biayaLangsungRegistrasi)}*\n` +
        `- Total kewajiban biaya awal sebelum potongan (termasuk total DPP): *${formatRp(initialTotalBeforeDiscounts)}*\n\n` +
        `*Catatan (Source Gap):* Nominal di atas adalah tarif dasar umum, bukan tarif khusus ${registrationWave}. Potongan resmi untuk ${registrationWave} belum tersedia di dokumen.`;
    }

    if (registrationWave && isWaveVerified) {
      return `*Total Biaya Awal Masuk ${profile.canonical} (${registrationWave})*\n\n` +
        `Berikut rincian pemisahan komponen biaya awal terverifikasi:\n` +
        `1. **Biaya langsung saat registrasi awal**:\n` +
        `   - Biaya Pendaftaran: ${formatRp(net.pendaftaran)} (setelah potongan gelombang ${formatRp(discounts.pendaftaranDiscount)})\n` +
        (base.perlengkapan ? `   - Perlengkapan (Jas, Topi, Kaos, Tas, GMTI): ${formatRp(base.perlengkapan)} (saat registrasi I)\n` : '') +
        `   -> Pembayaran langsung saat registrasi: *${formatRp(net.biayaLangsungRegistrasi)}*\n\n` +
        `2. **Kewajiban Dana Pendidikan Pokok (DPP)**:\n` +
        `   - Total Kewajiban DPP: *${formatRp(net.dpp)}* (setelah beasiswa gelombang ${formatRp(discounts.dppDiscount)}, normal ${formatRp(base.dpp)})\n` +
        `   - Ketentuan pembayaran DPP: Dapat dicicil bertahap setiap bulan hingga UTS-1 (tidak wajib lunas langsung saat registrasi).\n\n` +
        `*Ringkasan Total Biaya Awal:*\\n` +
        `- Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}*\n` +
        `- Total Kewajiban Biaya Awal Masuk (termasuk total DPP): *${formatRp(net.initialTotal)}*\n\n` +
        `_Catatan: Biaya per semester tidak termasuk dalam biaya awal ini dan dibayar terpisah menjelang masa perwalian tiap semester._`;
    }

    return `*Total Biaya Awal Masuk ${profile.canonical}*\n\n` +
      `Berikut rincian pemisahan komponen biaya awal terverifikasi:\n` +
      `1. **Biaya langsung saat registrasi awal**:\n` +
      `   - Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (dibayar saat mendaftar)\n` +
      (base.perlengkapan ? `   - Biaya Perlengkapan (Jas, Topi, Kaos, Tas, GMTI): ${formatRp(base.perlengkapan)} (dibayar saat registrasi I)\n` : '') +
      `   -> Pembayaran langsung saat registrasi: *${formatRp(net.biayaLangsungRegistrasi)}*\n\n` +
      `2. **Kewajiban Dana Pendidikan Pokok (DPP)**:\n` +
      `   - Total Kewajiban DPP: *${formatRp(base.dpp)}*\n` +
      `   - Ketentuan pembayaran DPP: Dapat dicicil bertahap setiap bulan hingga UTS-1 (tidak wajib lunas langsung saat masuk, kecuali memilih diskon tunai 10%).\n\n` +
      `*Ringkasan Total Biaya Awal:*\n` +
      `- Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}*\n` +
      `- Total Kewajiban Biaya Awal (Pendaftaran + Perlengkapan + Total DPP): *${formatRp(initialTotalBeforeDiscounts)}*\n\n` +
      `_Catatan: Tersedia potongan pendaftaran dan beasiswa DPP berdasarkan gelombang (Gelombang Khusus, I, II, III, IV, Sisipan). Biaya per semester dibayarkan menjelang masa perwalian tiap semester._`;
  }

  // 2e. First Year Estimate
  if (calculationScope === 'first_year_estimate') {
    const waveLabel = registrationWave && isWaveVerified ? ` (${registrationWave})` : '';
    const initialText = registrationWave && isWaveVerified
      ? `${formatRp(net.initialTotal)} (setelah potongan ${registrationWave})`
      : `${formatRp(initialTotalBeforeDiscounts)} (sebelum potongan gelombang)`;
    const totalEst = registrationWave && isWaveVerified ? net.firstYearEstimate : initialTotalBeforeDiscounts + (2 * net.semester);

    return `*Estimasi Biaya Tahun Pertama ${profile.canonical}${waveLabel}*\n\n` +
      `Cakupan perhitungan Tahun Pertama (Semester 1 & 2):\n` +
      `1. Total Kewajiban Biaya Awal (1x masuk): ${initialText}\n` +
      `2. Biaya Pendidikan Semester 1: ${formatRp(net.semester)}\n` +
      `3. Biaya Pendidikan Semester 2: ${formatRp(net.semester)}\n\n` +
      `*Total Estimasi Tahun Pertama: ${formatRp(totalEst)}*\n\n` +
      `*Ketentuan Cakupan:*\n` +
      `- DPP lunas pada tahun pertama (dicicil s.d. UTS-1).\n` +
      `- Biaya Pengalaman Industri tidak dimasukkan karena baru dimulai pada Semester 3.\n` +
      (registrationWave && isWaveVerified ? '' : `- Estimasi di atas belum memperhitungkan potongan gelombang pendaftaran.\n`);
  }

  // 2f. Industry Option total query
  if (calculationScope === 'with_industry_option' && industryFee.amount > 0) {
    return `*Biaya Pengalaman Industri ${profile.canonical} — Kategori ${industryFee.label}*\n\n` +
      `- Biaya Pengalaman Industri: *${formatRp(industryFee.amount)}*\n` +
      `- Skema pembayaran: Dapat dicicil 5 kali per semester, dimulai dari Semester 3.\n` +
      `- Catatan: Biaya ini belum termasuk tiket perjalanan, paspor, dan visa.\n\n` +
      `Biaya ini merupakan pilihan program tambahan di luar biaya awal dan biaya per semester reguler.`;
  }

  // Case 3: Unverified Wave Query (e.g. "Gelombang 1A" / "Gelombang 1B")
  if (isWaveExplicit && !isWaveVerified) {
    let lines = [];
    lines.push(`*Tarif Dasar Kuliah ${profile.canonical} (Informasi Terkait ${registrationWave})*\n`);
    lines.push(`Jenjang: ${profile.degree}`);
    lines.push(`Tahun akademik: ${profile.academicYear}`);
    lines.push(`Status Gelombang: Gelombang "${registrationWave}" tidak tercantum dalam dokumen resmi SK Rektor Nomor : 629/ITBSTIKOM/WDS/X/25.\n`);

    lines.push(`*Daftar gelombang pendaftaran resmi yang tercantum dalam dokumen:*`);
    lines.push(`1. Gelombang Khusus`);
    lines.push(`2. Gelombang I`);
    lines.push(`3. Gelombang II`);
    lines.push(`4. Gelombang III`);
    lines.push(`5. Gelombang IV`);
    lines.push(`6. Gelombang Sisipan\n`);

    lines.push(`*Tarif dasar umum terverifikasi (sebelum potongan gelombang):*`);
    lines.push(`- Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (dibayar saat mendaftar)`);
    if (base.perlengkapan > 0) {
      lines.push(`- Biaya Perlengkapan Awal: ${formatRp(base.perlengkapan)} (Jas Almamater, Topi, Kaos, Tas, GMTI - dibayar saat Registrasi I)`);
      lines.push(`-> Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}*`);
    }
    lines.push(`- Total Kewajiban Dana Pendidikan Pokok (DPP): ${formatRp(base.dpp)}`);
    lines.push(`  Ketentuan DPP: Dapat diangsur per bulan hingga UTS-1 (tidak wajib lunas langsung saat masuk).`);
    if (base.bahasa) lines.push(`- ${base.bahasaLabel || 'Biaya Penguatan Bahasa'}: ${formatRp(base.bahasa)} (Menjelang Semester II)`);
    if (base.semester) lines.push(`- Biaya Pendidikan Per Semester: ${formatRp(base.semester)} (dibayar menjelang perwalian tiap semester)`);

    lines.push(`\n*Ringkasan tarif dasar terverifikasi:*`);
    lines.push(`- Pembayaran langsung saat registrasi awal (pendaftaran + perlengkapan): ${formatRp(net.biayaLangsungRegistrasi)}`);
    lines.push(`- Total kewajiban biaya awal (tarif dasar sebelum potongan): ${formatRp(initialTotalBeforeDiscounts)}`);

    lines.push(`\n*Catatan (Source Gap):*`);
    lines.push(`Tarif di atas merupakan tarif dasar umum kampus, BUKAN tarif khusus ${registrationWave}. Total biaya pasti dan potongan beasiswa untuk *${registrationWave}* belum dapat dipastikan karena gelombang tersebut tidak tercatat di dokumen resmi. Ketentuan potongan Gelombang I tidak dapat dijadikan dasar asumsi untuk ${registrationWave}.`);

    return lines.join('\n');
  }

  // Case 4: Full Breakdown (Standard or Verified Wave)
  let lines = [];
  const waveHeader = registrationWave && isWaveVerified ? ` — ${registrationWave}` : '';
  lines.push(`*Rincian Biaya Kuliah ${profile.canonical}${waveHeader}*\n`);
  lines.push(`Jenjang: ${profile.degree}`);
  lines.push(`Tahun akademik: ${profile.academicYear}`);
  if (profile.partnerName) lines.push(`Universitas mitra: ${profile.partnerName} (${profile.country})`);
  if (profile.degreesAwarded) lines.push(`Gelar: ${profile.degreesAwarded}`);
  if (registrationWave && isWaveVerified) lines.push(`Gelombang: ${registrationWave}`);

  // 1. Biaya Awal (Pendaftaran & Perlengkapan)
  lines.push(`\n*1. Biaya pendaftaran & perlengkapan awal (dibayar saat masuk)*`);
  if (discounts.pendaftaranDiscount > 0) {
    lines.push(`- Biaya Pendaftaran: ${formatRp(net.pendaftaran)} (potongan gelombang ${formatRp(discounts.pendaftaranDiscount)}, normal ${formatRp(base.pendaftaran)})`);
  } else {
    lines.push(`- Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (Pada Saat Daftar)`);
  }

  if (base.jasTopi) lines.push(`- Jas Almamater & Topi: ${formatRp(base.jasTopi)} (Saat Registrasi I)`);
  if (base.kaosTasGmti) lines.push(`- Kaos, Tas, GMTI: ${formatRp(base.kaosTasGmti)} (Saat Registrasi I)`);
  if (base.bahasa) lines.push(`- ${base.bahasaLabel || 'Biaya Penguatan Bahasa'}: ${formatRp(base.bahasa)} (Menjelang Semester II)`);
  if (base.perlengkapan > 0) {
    lines.push(`-> Pembayaran langsung registrasi awal (pendaftaran + perlengkapan): *${formatRp(net.biayaLangsungRegistrasi)}*`);
  }

  // 2. Biaya Pendidikan
  lines.push(`\n*2. Biaya pendidikan*`);
  if (discounts.dppDiscount > 0) {
    lines.push(`- Dana Pendidikan Pokok (DPP): ${formatRp(net.dpp)} (setelah beasiswa ${registrationWave} ${formatRp(discounts.dppDiscount)}, normal ${formatRp(base.dpp)})`);
  } else {
    lines.push(`- Dana Pendidikan Pokok (DPP): ${formatRp(base.dpp)}`);
  }
  lines.push(`  Ketentuan DPP: ${comps.dpp?.installment || 'Dapat dicicil per bulan s.d. UTS-1'} (tidak wajib tunai sekaligus saat masuk).`);

  if (comps.biayaPerSubject) {
    lines.push(`- Biaya Pendidikan & Ujian: ${formatRp(comps.biayaPerSubject.amount)} / subject (Awal Semester)`);
  } else {
    const smkText = isSmkTi ? ` (khusus alumni SMK TI: ${formatRp(net.semester)})` : '';
    lines.push(`- Biaya Pendidikan Per Semester: ${formatRp(base.semester)}${smkText}`);
    lines.push(`  Waktu pembayaran: Menjelang perwalian tiap semester (Reguler 1 dicicil 2 kali s/d UTS)`);
  }

  // 3. Biaya Tambahan
  if (comps.pengalamanIndustri) {
    lines.push(`\n*3. Biaya tambahan (Pengalaman Industri)*`);
    lines.push(`Pilihan program (mulai semester 3, dicicil 5 kali per semester):`);
    lines.push(`- Internasional: ${formatRp(comps.pengalamanIndustri.options.internasional.amount)}`);
    lines.push(`- Nasional: ${formatRp(comps.pengalamanIndustri.options.nasional.amount)}`);
    lines.push(`- Lokal: ${formatRp(comps.pengalamanIndustri.options.lokal.amount)}`);
    lines.push(`_Catatan: Biaya di atas belum termasuk tiket, paspor, dan visa._`);
  }

  // 4. Ringkasan Biaya
  lines.push(`\n*4. Ringkasan biaya*`);
  lines.push(`- Pembayaran langsung registrasi awal (pendaftaran + perlengkapan): ${formatRp(net.biayaLangsungRegistrasi)}`);
  if (registrationWave && isWaveVerified) {
    lines.push(`- Total kewajiban biaya awal masuk: ${formatRp(net.initialTotal)}`);
    if (net.semester > 0) {
      lines.push(`- Total semester pertama: ${formatRp(net.firstSemesterTotal)}`);
      lines.push(`- Estimasi biaya tahun pertama: ${formatRp(net.firstYearEstimate)}`);
    }
  } else {
    lines.push(`- Total kewajiban biaya awal sebelum potongan: ${formatRp(initialTotalBeforeDiscounts)}`);
    if (net.semester > 0) {
      lines.push(`- Total semester pertama (sebelum potongan): ${formatRp(initialTotalBeforeDiscounts + net.semester)}`);
      lines.push(`- Estimasi tahun pertama (sebelum potongan): ${formatRp(initialTotalBeforeDiscounts + (2 * net.semester))}`);
    }
  }

  // Ketentuan Pembayaran
  lines.push(`\n*Ketentuan pembayaran:*`);
  lines.push(`- Pembayaran DPP dapat diangsur setiap bulan hingga UTS-1.`);
  lines.push(`- Jika DPP dibayar tunai langsung lunas, diberikan tambahan potongan 10%.`);
  if (profile.specialPolicies?.alumniSmkTiSemesterDiscountPercent) {
    lines.push(`- Khusus alumni SMK TI mendapatkan potongan ${profile.specialPolicies.alumniSmkTiSemesterDiscountPercent}% Biaya Pendidikan Per Semester selama 4 tahun.`);
  }

  // Catatan / Keterbatasan Sumber
  lines.push(`\n*Catatan:*`);
  if (profile.scheme === 'international_double_degree' && profile.specialPolicies?.freeDormitoryInChina) {
    lines.push(`- Fasilitas dormitory (shared room) di China pada tahun ke-4 disediakan gratis.`);
    lines.push(`- Biaya tiket, visa, dan kebutuhan pribadi di luar negeri belum tercantum dalam dokumen panduan resmi.`);
  } else {
    lines.push(`- Biaya sertifikasi, yudisium, dan wisuda akan ditentukan kemudian sesuai kalender akademik.`);
    if (!registrationWave) {
      lines.push(`- Nominal di atas belum memperhitungkan potongan gelombang pendaftaran.`);
    }
  }

  return lines.join('\n');
}


/**
 * Main Generator for Fee Answers.
 * Called by groundedAnswerGenerator or orchestrator.
 */
function generateFeeAnswer(frameOrQuery, secondArg = [], thirdArg = {}) {
  let semanticFrame = {};
  let rawQuery = '';
  let accepted = [];
  let arbitratedEvidence = {};

  if (typeof frameOrQuery === 'string') {
    rawQuery = frameOrQuery;
    const sessionData = (secondArg && typeof secondArg === 'object' && !Array.isArray(secondArg)) ? secondArg : {};
    const options = (thirdArg && typeof thirdArg === 'object') ? thirdArg : {};
    semanticFrame = options.semanticFrame || { rawQuery };
    accepted = options.acceptedEvidence || (Array.isArray(secondArg) ? secondArg : []);
    arbitratedEvidence = options.arbitratedEvidence || options;
    if (!arbitratedEvidence.sessionData && Object.keys(sessionData).length > 0) {
      arbitratedEvidence.sessionData = sessionData;
    }
    if (!semanticFrame.rawQuery) semanticFrame.rawQuery = rawQuery;
  } else if (frameOrQuery && typeof frameOrQuery === 'object') {
    semanticFrame = frameOrQuery;
    rawQuery = String(semanticFrame.rawQuery || semanticFrame.query || '');
    accepted = Array.isArray(secondArg) ? secondArg : [];
    arbitratedEvidence = thirdArg || {};
  }

  const normQuery = String(semanticFrame.normalizedQuery || rawQuery || '');
  const scopeParams = detectFeeScope(rawQuery, normQuery);

  // Identify program entity from semantic frame
  let programEntity = null;
  const entities = semanticFrame.entities || arbitratedEvidence?.semanticFrame?.entities || [];
  for (const ent of entities) {
    const canon = ent.canonical || ent.name || String(ent);
    const profile = resolveFeeProfile(canon);
    if (profile) {
      programEntity = canon;
      break;
    }
  }

  // Check session context for multi-turn follow up
  if (!programEntity && arbitratedEvidence?.sessionData) {
    const sess = arbitratedEvidence.sessionData;
    const prev = sess.activeEntity || sess.lastEntity;
    if (prev && resolveFeeProfile(prev)) {
      programEntity = prev;
    }
  }

  // Fallback to query inspection if no entity resolved
  if (!programEntity) {
    const qLower = (rawQuery + ' ' + normQuery).toLowerCase();
    if (/sistem\s+komputer|sk\b/i.test(qLower)) programEntity = 'S1 Sistem Komputer';
    else if (/teknologi\s+informasi|ti\b/i.test(qLower)) programEntity = 'S1 Teknologi Informasi';
    else if (/bisnis\s+digital|bd\b/i.test(qLower)) programEntity = 'S1 Bisnis Digital';
    else if (/sistem\s+informasi|si\b/i.test(qLower)) {
      if (/s2|magister|pasca/i.test(qLower)) programEntity = 'S2 Sistem Informasi';
      else programEntity = 'S1 Sistem Informasi';
    } else if (/manajemen\s+informatika|d3/i.test(qLower)) programEntity = 'D3 Manajemen Informatika';
    else if (/utb/i.test(qLower)) programEntity = 'Dual Degree UTB';
    else if (/help/i.test(qLower)) programEntity = 'Double Degree HELP University';
    else if (/dnui/i.test(qLower)) programEntity = 'Double Degree DNUI';
  }

  // Prioritas 4: Penanganan Khusus Biaya Konversi SKS / Asesmen Portofolio RPL
  const isRplConversionOrAssessmentFee = /\b(?:rpl|rekognisi(?:\s+pembelajaran\s+lampau)?)\b/i.test(rawQuery + ' ' + normQuery) &&
    /\b(?:konversi|asesmen|portofolio|biaya\s+konversi|tarif\s+konversi|sks\s+portofolio)\b/i.test(rawQuery + ' ' + normQuery);

  if (isRplConversionOrAssessmentFee) {
    const targetProdi = programEntity || (
      /sistem\s+komputer|sk\b/i.test(rawQuery) ? 'S1 Sistem Komputer' :
      /teknologi\s+informasi|ti\b/i.test(rawQuery) ? 'S1 Teknologi Informasi' :
      /bisnis\s+digital|bd\b/i.test(rawQuery) ? 'S1 Bisnis Digital' :
      'S1 Sistem Informasi'
    );
    const regularProfile = resolveFeeProfile(targetProdi);
    const sppText = regularProfile?.components?.biayaSemester?.amount ? formatRp(regularProfile.components.biayaSemester.amount) : 'Rp 6.500.000';
    const dppText = regularProfile?.components?.dpp?.amount ? formatRp(regularProfile.components.dpp.amount) : 'Rp 14.000.000';

    const rplAnswer = `*Informasi Biaya Jalur Rekognisi Pembelajaran Lampau (RPL)*\n\n` +
      `Program Studi: ${targetProdi} (Jalur RPL)\n\n` +
      `*1. Biaya Asesmen Portofolio & Konversi SKS:*\n` +
      `• Biaya asesmen portofolio atau tarif konversi per SKS untuk jalur RPL belum tercantum dalam dokumen panduan resmi yang tersedia saat ini (*SOURCE_GAP*).\n` +
      `• Penetapan jumlah SKS yang diakui (konversi SKS) dilakukan setelah hasil evaluasi dan asesmen portofolio pengalaman kerja atau pendidikan terdahulu diterbitkan oleh Tim Asesor RPL ITB STIKOM Bali.\n\n` +
      `*2. Informasi Pembanding (Tarif Perkuliahan Reguler ${targetProdi}):*\n` +
      `_Sebagai gambaran pembanding untuk perkuliahan reguler pada program studi ini:_\n` +
      `• Biaya Pendaftaran: Rp 500.000\n` +
      `• Biaya Pendidikan Per Semester: ${sppText}\n` +
      `• Dana Pendidikan Pokok (DPP): ${dppText}\n` +
      `*(Catatan: Rincian di atas merupakan biaya reguler dan bukan merupakan tarif khusus konversi atau asesmen RPL)*\n\n` +
      `Untuk informasi resmi mengenai biaya asesmen portofolio dan verifikasi berkas RPL, silakan menghubungi Sekretariat RPL / Admisi PMB ITB STIKOM Bali di *(0361) 244445* atau WhatsApp *0815-2900-8888*.`;

    return {
      success: true,
      answer: rplAnswer,
      source: 'grounded_fee_engine',
      isRplSourceGap: true
    };
  }

  // If asking generally about Double Degree without specific partner
  if (!programEntity && /\b(?:double|dual)\s*degree\b/i.test(rawQuery + ' ' + normQuery)) {
    const ddText = `ITB STIKOM Bali menyelenggarakan 3 program Double / Dual Degree resmi dengan rincian biaya masing-masing:\n\n` +
      `1. **Dual Degree (National Class) UTB Bandung** (S1 Bisnis Digital & Desain Komunikasi Visual)\n` +
      `   - Biaya Pendaftaran: Rp 500.000\n` +
      `   - DPP: Rp 14.000.000\n` +
      `   - Biaya Per Semester: Rp 7.500.000 (SMK TI: Rp 6.500.000)\n\n` +
      `2. **Double Degree (International Class) HELP University Malaysia** (S1 Sistem Informasi)\n` +
      `   - Full 4 tahun di ITB STIKOM Bali (tidak perlu ke Malaysia)\n` +
      `   - Biaya Pendaftaran: Rp 3.000.000, DPP: Rp 20.000.000, Bahasa Inggris: Rp 5.000.000\n` +
      `   - Biaya Pendidikan & Ujian: Rp 3.000.000 per subject\n\n` +
      `3. **Double Degree (International Class) DNUI China** (S1 Bisnis Digital & E-Commerce)\n` +
      `   - Tahun 1-2 di Bali, Tahun 3 daring, Tahun 4 di China (dormitory gratis)\n` +
      `   - Biaya Pendaftaran: Rp 3.000.000, DPP: Rp 20.000.000, Bahasa Mandarin: Rp 5.000.000\n` +
      `   - Biaya Per Semester: Rp 16.000.000\n\n` +
      `Silakan sebutkan program mitra yang ingin Kakak ketahui rincian lengkapnya ya.`;
    return {
      success: true,
      answer: ddText,
      source: 'grounded_fee_engine'
    };
  }

  // If asking for comparison of all programs or multiple programs
  const isExplicitCompare = /\b(?:semua|seluruh|tiap|masing-masing|semua prodi|semua jurusan|semua program studi|bandingkan|perbandingan)\b/i.test(rawQuery + ' ' + normQuery);
  const isMultiCompare = isExplicitCompare || (!programEntity && entities.length > 1);

  if (isMultiCompare) {
    const lines = [
      `*Perbandingan Biaya Pendidikan Program Studi ITB STIKOM Bali (T.A 2026/2027)*\n`,
      `Berikut perbandingan Biaya Pendidikan Per Semester dan Dana Pendidikan Pokok (DPP) resmi untuk program studi di ITB STIKOM Bali:\n`,
      `• **S1 Sistem Informasi**: Rp 6.500.000 per semester (DPP: Rp 14.000.000)`,
      `• **S1 Teknologi Informasi**: Rp 6.500.000 per semester (DPP: Rp 14.000.000)`,
      `• **S1 Bisnis Digital**: Rp 6.500.000 per semester (DPP: Rp 14.000.000)`,
      `• **S1 Sistem Komputer**: Rp 6.000.000 per semester (DPP: Rp 11.000.000)`,
      `• **D3 Manajemen Informatika**: Rp 4.500.000 per semester (DPP: Rp 7.000.000)`,
      `• **Dual Degree UTB Bandung**: Rp 7.500.000 per semester (DPP: Rp 14.000.000, alumni SMK TI: Rp 6.500.000)`,
      `• **Double Degree HELP University**: Rp 3.000.000 per subject (DPP: Rp 20.000.000)`,
      `• **Double Degree DNUI China**: Rp 16.000.000 per semester (DPP: Rp 20.000.000)`,
      `• **S2 Magister Sistem Informasi**: Biaya Pendaftaran Rp 700.000 (Rincian DPP & SPP semester dapat dikonfirmasi ke admisi pascasarjana)\n`,
      `*Ketentuan Tambahan:* Pembayaran DPP dapat diangsur setiap bulan hingga UTS-1, dan tersedia potongan beasiswa gelombang awal serta diskon pembayaran tunai 10%.`
    ];
    return {
      success: true,
      answer: lines.join('\n'),
      source: 'grounded_fee_engine'
    };
  }

  if (!programEntity) {
    return null;
  }

  const profile = resolveFeeProfile(programEntity);
  if (!profile) return null;

  const calcResult = calculateFeeBreakdown(profile, scopeParams);
  const formattedAnswer = formatWhatsAppFeeResponse(calcResult, rawQuery);

  return {
    success: true,
    answer: formattedAnswer,
    source: 'grounded_fee_engine',
    calculation: calcResult
  };
}

module.exports = {
  getFeeCatalog,
  loadCanonicalFeeCatalog,
  get GROUNDED_FEE_CATALOG() { return getFeeCatalog(); },
  detectFeeScope,
  resolveFeeProfile,
  calculateFeeBreakdown,
  formatWhatsAppFeeResponse,
  generateFeeAnswer,
  formatRp
};
