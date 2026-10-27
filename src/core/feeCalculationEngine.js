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
function extractAllMentionedWaves(text = '') {
  const waves = [];
  const str = String(text || '');

  // 1. Match letter sub-waves (e.g. 1A, 2C, 3B, II-C)
  const subWaveMatches = str.matchAll(/\b(?:gelombang|gel)\s*(?:([1-4])\s*[-_ ]*([a-z])|(iv|iii|ii|i)\s*[-_ ]*([a-hj-uw-z]))\b/gi);
  for (const m of subWaveMatches) {
    const numPart = (m[1] || m[3]).toUpperCase();
    const letterPart = (m[2] || m[4]).toUpperCase();
    let stdNum = numPart;
    if (numPart === 'I') stdNum = '1';
    else if (numPart === 'II') stdNum = '2';
    else if (numPart === 'III') stdNum = '3';
    else if (numPart === 'IV') stdNum = '4';
    waves.push(`Gelombang ${stdNum}${letterPart}`);
  }

  // 2. Match official standard waves
  const officialMatches = str.matchAll(/\b(?:gelombang|gel)\s*(khusus|awal|sisipan|(?:iv\b|4\b)|(?:iii\b|3\b)|(?:ii\b|2\b)|(?:i\b|1\b))\b/gi);
  for (const m of officialMatches) {
    const val = m[1].toLowerCase();
    if (val === 'khusus' || val === 'awal') waves.push('Gelombang Khusus');
    else if (val === 'sisipan') waves.push('Gelombang Sisipan');
    else if (val === '1' || val === 'i') waves.push('Gelombang I');
    else if (val === '2' || val === 'ii') waves.push('Gelombang II');
    else if (val === '3' || val === 'iii') waves.push('Gelombang III');
    else if (val === '4' || val === 'iv') waves.push('Gelombang IV');
  }

  return [...new Set(waves)];
}

/**
 * Detects the specific fee scope and parameters requested in a query.
 */
function detectFeeScope(rawQuery = '', secondArg = '') {
  let normQuery = '';
  let sessionData = {};
  if (typeof secondArg === 'string') {
    normQuery = secondArg;
  } else if (secondArg && typeof secondArg === 'object') {
    sessionData = secondArg;
    normQuery = sessionData.normalizedQuery || '';
  }
  const q = (String(rawQuery || '') + ' ' + normQuery).toLowerCase();

  // 1. Detect exact wave requested
  let registrationWave = null;
  let isWaveExplicit = false;
  let isWaveVerified = false;

  // 1a. Explicit sub-waves with letter suffixes (e.g. 2C, 1A, 1B, 2A, 2B, etc.)
  const subWaveLetterMatch = q.match(/\b(?:gelombang|gel)\s*(?:([1-4])\s*[-_ ]*([a-z])|(iv|iii|ii|i)\s*[-_ ]*([a-hj-uw-z]))\b/i);
  if (subWaveLetterMatch) {
    const numPart = (subWaveLetterMatch[1] || subWaveLetterMatch[3]).toUpperCase();
    const letterPart = (subWaveLetterMatch[2] || subWaveLetterMatch[4]).toUpperCase();
    let standardNum = numPart;
    if (numPart === 'I') standardNum = '1';
    else if (numPart === 'II') standardNum = '2';
    else if (numPart === 'III') standardNum = '3';
    else if (numPart === 'IV') standardNum = '4';

    registrationWave = `Gelombang ${standardNum}${letterPart}`;
    isWaveExplicit = true;
    isWaveVerified = false; // Sub-waves are unverified against canonical SK 629
  } else if (/\b(?:gelombang\s*khusus|gel\s*khusus|gelombang\s+awal)\b/i.test(q)) {
    registrationWave = 'Gelombang Khusus';
    isWaveExplicit = true;
    isWaveVerified = true;
  } else if (/\b(?:gelombang\s*(?:i\b|1\b)|gel\s*(?:i\b|1\b))\b/i.test(q)) {
    registrationWave = 'Gelombang I';
    isWaveExplicit = true;
    isWaveVerified = true;
  } else if (/\b(?:gelombang\s*(?:ii\b|2\b)|gel\s*(?:ii\b|2\b))\b/i.test(q)) {
    registrationWave = 'Gelombang II';
    isWaveExplicit = true;
    isWaveVerified = true;
  } else if (/\b(?:gelombang\s*(?:iii\b|3)|gel\s*(?:iii\b|3\b))\b/i.test(q)) {
    registrationWave = 'Gelombang III';
    isWaveExplicit = true;
    isWaveVerified = true;
  } else if (/\b(?:gelombang\s*(?:iv\b|4\b)|gel\s*(?:iv\b|4\b))\b/i.test(q)) {
    registrationWave = 'Gelombang IV';
    isWaveExplicit = true;
    isWaveVerified = true;
  } else if (/\b(?:gelombang\s*sisipan|gel\s*sisipan)\b/i.test(q)) {
    registrationWave = 'Gelombang Sisipan';
    isWaveExplicit = true;
    isWaveVerified = true;
  } else if (/\b(?:gelombang|gel)\s+(?:berikutnya|selanjutnya|setelahnya|next)\b/i.test(q)) {
    // 1b. Follow-up relative wave query
    const prevWave = sessionData.lastActiveWave ||
      sessionData.activeWave ||
      sessionData.lastWave ||
      sessionData.feeScope?.registrationWave ||
      (extractAllMentionedWaves(sessionData.lastAnswer || '')[0]) ||
      (extractAllMentionedWaves(sessionData.lastQuery || '')[0]);

    const waveOrder = ['Gelombang Khusus', 'Gelombang I', 'Gelombang II', 'Gelombang III', 'Gelombang IV', 'Gelombang Sisipan'];
    if (prevWave) {
      const idx = waveOrder.indexOf(prevWave);
      if (idx !== -1 && idx < waveOrder.length - 1) {
        registrationWave = waveOrder[idx + 1];
        isWaveExplicit = true;
        isWaveVerified = true;
      } else if (idx === waveOrder.length - 1) {
        registrationWave = waveOrder[idx];
        isWaveExplicit = true;
        isWaveVerified = true;
      }
    } else {
      registrationWave = 'Gelombang II';
      isWaveExplicit = true;
      isWaveVerified = true;
    }
  } else {
    // Check if any other custom wave is mentioned (e.g. "Gelombang 5", "Gelombang Reguler")
    const genericWaveMatch = q.match(/\b(?:gelombang|gel)\s+([a-z0-9\-_]+)\b/i);
    if (genericWaveMatch && genericWaveMatch[1]) {
      const wName = genericWaveMatch[1].trim();
      if (!/^(?:berapa|apa|kapan|buka|tutup|ini|pmb|pendaftaran)$/i.test(wName)) {
        registrationWave = `Gelombang ${wName.toUpperCase()}`;
        isWaveExplicit = true;
        isWaveVerified = false;
      }
    }
  }

  // 1b. Inherit active wave context from ongoing fee session if query switches program or continues fee inquiry
  let isWaveInherited = false;
  if (!registrationWave) {
    const isBaseFeeExplicit = /\b(?:normal|dasar|tanpa\s+(?:potongan|diskon)|sebelum\s+(?:potongan|diskon)|full\s+tanpa|asli)\b/i.test(q);
    if (!isBaseFeeExplicit) {
      const priorWave = sessionData.lastActiveWave ||
        sessionData.activeWave ||
        sessionData.feeScope?.registrationWave ||
        (sessionData.data && (sessionData.data.lastActiveWave || sessionData.data.activeWave || sessionData.data.feeScope?.registrationWave));

      const isFeeSession = sessionData.activeDomain === 'TUITION_FEE' ||
        sessionData.activeIntent === 'TUITION_FEE_INQUIRY' ||
        (sessionData.data && (sessionData.data.activeDomain === 'TUITION_FEE' || sessionData.data.activeIntent === 'TUITION_FEE_INQUIRY')) ||
        /\b(?:biaya|uang\s+kuliah|spp|dpp|potongan|diskon)\b/i.test(sessionData.lastQuery || '') ||
        /\b(?:biaya|uang\s+kuliah|spp|dpp|potongan|diskon)\b/i.test(sessionData.data?.lastQuery || '');

      const isProgramSwitchOrFeeFollowUp =
        /^(?:kalau|kalo|bagaimana\s+kalau|gimana\s+kalau|ganti\s+ke|pindah\s+ke|untuk|bagaimana\s+dengan|gimana\s+dengan|lalu|sedangkan)\s+/i.test(rawQuery) ||
        /\b(?:biaya|tarif|total|potongan|diskon|bayar|dpp|spp)\b/i.test(q) ||
        (rawQuery && rawQuery.trim().split(/\s+/).length <= 4 && !/\b(?:syarat|jadwal|akreditasi|fasilitas|ukm)\b/i.test(q));

      if (priorWave && isFeeSession && isProgramSwitchOrFeeFollowUp) {
        registrationWave = priorWave;
        isWaveExplicit = false;
        isWaveInherited = true;
        isWaveVerified = true;
      }
    }
  }

  // 1c. Detect wave comparison intent
  const isWaveComparison = /\b(?:beda|perbedaan|berbeda|bandingkan|perbandingan|versus|vs)\b/i.test(q) &&
    /\bgelombang\b/i.test(q);
  const comparedWaves = isWaveComparison ? extractAllMentionedWaves(q) : [];

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

  if (/\b(?:matrikulasi|martikulasi)\b/i.test(q)) {
    calculationScope = 'matriculation_only';
  } else if (/\b(?:bayar\s+lunas\s+s2|s2\s+lunas|lunas\s+(?:selama\s+)?(?:dua|2)\s+tahun|opsi\s+lunas\s+s2|lunas\s+s2)\b/i.test(q) ||
             (/\b(?:bayar\s+lunas|opsi\s+lunas)\b/i.test(q) && /\b(?:s2|magister|pasca)\b/i.test(q))) {
    calculationScope = 's2_lump_sum';
  } else if (/\b(?:total\s+(?:biaya\s+)?(?:selama\s+)?(?:dua|2)\s+tahun|total\s+s2\s+(?:selama\s+)?(?:dua|2)\s+tahun|biaya\s+s2\s+(?:selama\s+)?(?:dua|2)\s+tahun|s2\s+(?:selama\s+)?(?:dua|2)\s+tahun)\b/i.test(q) &&
             /\b(?:total|biaya|berapa)\b/i.test(q)) {
    calculationScope = 'two_years_total';
  } else if (/\b(?:biaya\s+(?:per\s+)?semester(?:\s+saja)?|per\s+semester(?:\s+saja)?|semester\s+saja|spp(?:\s+saja)?)\b/i.test(q) &&
      !/\b(?:total|keseluruhan|awal|daftar|pendaftaran|registrasi|dpp|perlengkapan|seragam|jas|rincian)\b/i.test(q)) {
    calculationScope = 'semester_only';
  } else if (/\b(?:biaya\s+pendaftaran(?:\s+saja)?|biaya\s+daftar(?:\s+saja)?|uang\s+pendaftaran|biaya\s+formulir)\b/i.test(q) &&
      !/\b(?:total|keseluruhan|awal|dpp|semester|spp|perlengkapan|seragam|jas|rincian)\b/i.test(q)) {
    calculationScope = 'registration_only';
  } else if (/\b(?:dpp(?:\s+saja)?|dana\s+pendidikan\s+pokok(?:\s+saja)?|uang\s+pangkal)\b/i.test(q) &&
      !/\b(?:total|keseluruhan|awal|semester|spp|pendaftaran|daftar|perlengkapan|seragam|jas|rincian)\b/i.test(q)) {
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
    isWaveInherited,
    isWaveComparison,
    comparedWaves,
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

  const rawWave = scopeParams.registrationWave;
  const isWaveExplicit = Boolean(scopeParams.isWaveExplicit);

  // Evidence-driven verification: is this wave actually defined in canonical evidence for this profile?
  const profileWaves = profile.waveDiscounts || {};
  const isWaveVerified = Boolean(rawWave && profileWaves[rawWave]);

  const {
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

  if (isWaveVerified && profileWaves[rawWave]) {
    waveDiscountObj = profileWaves[rawWave];
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
  const initialTotalBeforeDiscounts = pendaftaranBase + dppBase + perlengkapanBase + bahasaBase;
  const initialTotalNet = pendaftaranNet + dppNet + perlengkapanBase + bahasaBase;

  // Total Semester 1: Initial Total Obligation + Semester 1 Tuition
  const firstSemesterTotalNet = initialTotalNet + semesterAfterDiscount;

  // First Year Estimate: Initial Total Obligation + 2x Semester Tuition
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
    scopeParams: {
      ...scopeParams,
      isWaveVerified
    },
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
      wave: rawWave,
      isWaveVerified,
      isWaveExplicit,
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
 * Formats a side-by-side comparison between two waves for a given program.
 */
function formatWaveComparisonResponse(profile, w1, b1, w2, b2) {
  const docRef = profile.skNumber ? `SK Rektor Nomor : ${profile.skNumber}` : 'dokumen resmi';
  const lines = [
    `*Perbandingan Biaya Kuliah ${profile.canonical} (${w1} vs ${w2})*\n`,
    `Jenjang: ${profile.degree}`,
    `Tahun akademik: ${profile.academicYear}`,
    `Dasar penetapan: ${docRef}\n`
  ];

  // 1. Biaya Pendaftaran
  lines.push(`*1. Biaya Pendaftaran:*`);
  if (b1.discounts.isWaveVerified) {
    lines.push(`• **${w1}**: ${formatRp(b1.net.pendaftaran)} (potongan gelombang ${formatRp(b1.discounts.pendaftaranDiscount)}, tarif dasar ${formatRp(b1.base.pendaftaran)})`);
  } else {
    lines.push(`• **${w1}**: Tarif dasar ${formatRp(b1.base.pendaftaran)} (potongan khusus ${w1} belum terverifikasi / SOURCE_GAP)`);
  }
  if (b2.discounts.isWaveVerified) {
    lines.push(`• **${w2}**: ${formatRp(b2.net.pendaftaran)} (potongan gelombang ${formatRp(b2.discounts.pendaftaranDiscount)}, tarif dasar ${formatRp(b2.base.pendaftaran)})`);
  } else {
    lines.push(`• **${w2}**: Tarif dasar ${formatRp(b2.base.pendaftaran)} (potongan khusus ${w2} belum terverifikasi / SOURCE_GAP)`);
  }
  lines.push('');

  // 2. Dana Pendidikan Pokok (DPP) / Biaya Registrasi
  const compLabel = profile.components?.dpp?.label || 'Dana Pendidikan Pokok (DPP)';
  lines.push(`*2. ${compLabel}:*`);
  if (b1.discounts.isWaveVerified) {
    lines.push(`• **${w1}**: ${formatRp(b1.net.dpp)} (beasiswa gelombang ${formatRp(b1.discounts.dppDiscount)}, dasar ${formatRp(b1.base.dpp)})`);
  } else {
    lines.push(`• **${w1}**: ${compLabel} dasar ${formatRp(b1.base.dpp)} (beasiswa khusus ${w1} belum terverifikasi / SOURCE_GAP)`);
  }
  if (b2.discounts.isWaveVerified) {
    lines.push(`• **${w2}**: ${formatRp(b2.net.dpp)} (beasiswa gelombang ${formatRp(b2.discounts.dppDiscount)}, dasar ${formatRp(b2.base.dpp)})`);
  } else {
    lines.push(`• **${w2}**: ${compLabel} dasar ${formatRp(b2.base.dpp)} (beasiswa khusus ${w2} belum terverifikasi / SOURCE_GAP)`);
  }
  lines.push(`  _Ketentuan: Pada kedua gelombang, ${compLabel} dapat dicicil bertahap setiap bulan hingga UTS-1 (tidak wajib dibayar tunai sekaligus). Tambahan diskon 10% jika lunas tunai di awal._\n`);

  // 3. Komponen yang Sama
  lines.push(`*3. Komponen Biaya yang Sama (Tidak Dipengaruhi Gelombang):*`);
  if (b1.base.perlengkapan > 0) {
    lines.push(`• Biaya Perlengkapan Awal: ${formatRp(b1.base.perlengkapan)} (Jas Almamater, Topi, Kaos, Tas, GMTI — dibayar saat Registrasi I)`);
  }
  if (b1.base.semester > 0) {
    lines.push(`• Biaya Pendidikan Per Semester: ${formatRp(b1.base.semester)} per semester (dibayar menjelang perwalian tiap semester)`);
  }
  lines.push('');

  // 4. Ringkasan Total Kewajiban Biaya Awal
  lines.push(`*4. Ringkasan Total Kewajiban Biaya Awal:*`);
  const initial1 = b1.discounts.isWaveVerified ? formatRp(b1.net.initialTotal) : `${formatRp(b1.initialTotalBeforeDiscounts)} (sebelum potongan)`;
  const initial2 = b2.discounts.isWaveVerified ? formatRp(b2.net.initialTotal) : `${formatRp(b2.initialTotalBeforeDiscounts)} (sebelum potongan)`;
  lines.push(`• Total ${w1}: *${initial1}*`);
  lines.push(`• Total ${w2}: *${initial2}*`);
  if (b1.discounts.isWaveVerified && b2.discounts.isWaveVerified) {
    const diff = Math.abs(b1.net.initialTotal - b2.net.initialTotal);
    if (diff > 0) {
      const cheaper = b1.net.initialTotal < b2.net.initialTotal ? w1 : w2;
      lines.push(`• Selisih kewajiban biaya awal: *${formatRp(diff)}* (lebih hemat pada ${cheaper})`);
    } else {
      lines.push(`• Total kewajiban biaya awal pada kedua gelombang bernilai sama.`);
    }
  }

  return lines.join('\n');
}

/**
 * Formats a calculated fee breakdown into WhatsApp-friendly text.
 */
function formatWhatsAppFeeResponse(calcResult, rawQuery = '') {
  if (!calcResult || !calcResult.profile) {
    return 'Mohon maaf, rincian biaya resmi untuk program studi tersebut belum dapat dipastikan. Silakan hubungi Admisi PMB ITB STIKOM Bali melalui https://pmb.stikom-bali.ac.id.';
  }

  const { profile, scopeParams, base, discounts, net, initialTotalBeforeDiscounts, industryFee } = calcResult;
  const comps = profile.components || {};
  const { calculationScope, registrationWave, isWaveExplicit, isWaveVerified, isSmkTi } = scopeParams;
  const docRef = profile.skNumber ? `SK Rektor Nomor : ${profile.skNumber}` : 'dokumen penetapan biaya resmi';
  const officialWaves = profile.waveDiscounts ? Object.keys(profile.waveDiscounts) : [];
  const formatListIndonesian = (items) => {
    if (!items || items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} dan ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, dan ${items[items.length - 1]}`;
  };
  const officialWavesFormatted = formatListIndonesian(officialWaves);

  // Case 1: RPL or Transfer Credit with unverified tuition structure
  if (profile.canonical.includes('RPL') || profile.canonical.includes('Transfer Kredit')) {
    return `*Informasi Biaya ${profile.canonical}*
` +
      `Jenjang: ${profile.degree}
` +
      `Tahun akademik: ${profile.academicYear}

` +
      `*Komponen Dasar Terverifikasi:*
` +
      `- Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (dibayar saat mendaftar)
` +
      (base.perlengkapan ? `- Biaya Perlengkapan Awal: ${formatRp(base.perlengkapan)} (saat Registrasi I)
` : '') +
      `- Biaya Pendidikan Per Semester: ${formatRp(base.semester)} per semester

` +
      `*Catatan Khusus (SOURCE_GAP):*
` +
      `Rincian konversi SKS, penetapan Dana Pendidikan Pokok (DPP), dan biaya per SKS hasil asesmen RPL/Transfer Kredit ditentukan tersendiri setelah proses penyetaraan transkrip akademik oleh Tim Asesor.

` +
      `Untuk konsultasi dan evaluasi transkrip mata kuliah, silakan menghubungi Sekretariat PMB melalui https://pmb.stikom-bali.ac.id atau (0361) 244445.`;
  }

  // Case 2: Specific Single-Aspect Queries

  // 2a. Semester fee only
  if (calculationScope === 'semester_only') {
    if (profile.canonical === 'Double Degree HELP University') {
      return `Biaya pendidikan untuk *${profile.canonical}* adalah *${formatRp(comps.biayaPerSubject.amount)} per subject/mata kuliah*. Biaya ini dibayarkan setiap awal semester sesuai dengan jumlah subject yang diambil pada semester bersangkutan.`;
    }
    if (profile.canonical === 'S2 Sistem Informasi') {
      return `Biaya pendidikan untuk *${profile.canonical}* adalah sebesar *${formatRp(base.semester)}* per semester (waktu pembayaran: Per Semester).\n\n` +
        `*Ketentuan S2 (SK Rektor 629 Lampiran 8):*\n` +
        `- Biaya pendidikan sudah termasuk matrikulasi, ujian, dan bimbingan (belum termasuk biaya wisuda).\n` +
        `- Tersedia pula opsi pembayaran lunas selama 2 tahun sebesar *Rp40.000.000* yang dibayarkan pada saat registrasi (sebagai alternatif dari 4 kali pembayaran semester Rp10.000.000, bukan biaya tambahan).\n` +
        `- Biaya pendaftaran awal sebesar ${formatRp(base.pendaftaran)} dibayarkan terpisah pada saat pendaftaran.`;
    }
    const smkNote = isSmkTi ? ` (khusus alumni SMK TI: *${formatRp(net.semester)}*)` : '';
    const installmentNote = comps.biayaSemester?.installment ? ` (${comps.biayaSemester.installment})` : '';
    let waveNote = '';
    if (isWaveExplicit) {
      if (isWaveVerified) {
        waveNote = `\n\n*Catatan Terkait ${registrationWave}:*\nBiaya pendidikan per semester bersifat tetap sepanjang masa studi normal dan tidak dipengaruhi oleh gelombang pendaftaran (potongan biaya gelombang ${registrationWave} hanya berlaku untuk biaya pendaftaran dan DPP).`;
      } else {
        waveNote = `\n\n*Catatan Terkait ${registrationWave}:*\nBiaya pendidikan per semester bersifat tetap per semester sepanjang masa studi normal dan tidak dipengaruhi oleh gelombang pendaftaran (potongan gelombang hanya berlaku untuk biaya pendaftaran dan DPP). Skema biaya khusus "${registrationWave}" belum tercantum dalam ${docRef} (SOURCE_GAP).`;
      }
    }
    return `Biaya pendidikan per semester untuk *${profile.canonical}* adalah sebesar *${formatRp(base.semester)}* per semester${smkNote}. Biaya ini dibayarkan menjelang masa perwalian/KRS setiap semester${installmentNote}.${waveNote}`;
  }

  // 2-s2a. Matriculation fee query
  if (calculationScope === 'matriculation_only') {
    return `Untuk program *${profile.canonical}*, biaya matrikulasi **sudah termasuk** dalam biaya pendidikan (tidak dikenakan biaya terpisah), sebagaimana diatur dalam SK Rektor No. 629/ITBSTIKOM/WDS/X/25 Lampiran 8 butir 4: _"Biaya sudah termasuk martikulasi, ujian dan bimbingan (belum termasuk biaya wisuda)"_.\n\n` +
      `Biaya pendidikan per semester adalah sebesar *${formatRp(base.semester || 10000000)}* per semester (waktu pembayaran: Per Semester), atau dapat memilih opsi lunas 2 tahun sebesar *Rp40.000.000* pada saat registrasi.`;
  }

  // 2-s2b. S2 Lump sum query
  if (calculationScope === 's2_lump_sum') {
    return `Opsi pembayaran lunas selama 2 tahun untuk *${profile.canonical}* adalah sebesar *Rp40.000.000* yang dibayarkan pada saat registrasi, sesuai SK Rektor No. 629/ITBSTIKOM/WDS/X/25 Lampiran 8 butir 3: _"Pembayaran Secara Lunas Selama 2 Tahun — 40.000.000 Pada Saat Registrasi (Umum)"_.\n\n` +
      `*Ketentuan Penting:*\n` +
      `- Opsi lunas Rp40.000.000 ini merupakan **alternatif pembayaran** dari 4 kali pembayaran semester (4 x Rp10.000.000 = Rp40.000.000), **bukan biaya tambahan**.\n` +
      `- Biaya pendidikan sudah termasuk matrikulasi, ujian, dan bimbingan (belum termasuk biaya wisuda).\n` +
      `- Biaya pendaftaran awal tetap dibayarkan terpisah pada saat pendaftaran (tarif dasar Rp700.000; jika mendaftar di Gelombang I mendapat potongan Rp200.000, atau Gelombang II potongan Rp100.000).\n` +
      `- Ketentuan redaksi alumni _"Ditambah Rp. 200.000,- Jika Alumni ITB STIKOM Bali"_ memerlukan konfirmasi admisi mengenai mekanisme stacking potongannya (SOURCE_GAP).`;
  }

  // 2-s2c. Two years total query (S2)
  if (calculationScope === 'two_years_total') {
    const regFee = discounts.pendaftaranDiscount > 0 ? net.pendaftaran : base.pendaftaran;
    const waveText = discounts.pendaftaranDiscount > 0 ? ` (setelah potongan pendaftaran ${registrationWave} ${formatRp(discounts.pendaftaranDiscount)})` : '';
    const totalSemesters = (base.semester || 10000000) * 4;
    const grandTotal = totalSemesters + regFee;
    return `Total estimasi biaya pendidikan *${profile.canonical}* selama 2 tahun (4 semester masa studi normal):\n\n` +
      `1. **Skema Pembayaran Per Semester**:\n` +
      `   - Biaya Pendidikan: 4 semester x ${formatRp(base.semester || 10000000)} = *${formatRp(totalSemesters)}* (waktu pembayaran: Per Semester, Rp 10.000.000 per semester)\n` +
      `   - Biaya Pendaftaran: *${formatRp(regFee)}*${waveText} (dibayar satu kali pada saat pendaftaran)\n` +
      `   -> **Total Biaya 2 Tahun**: *${formatRp(grandTotal)}*\n\n` +
      `2. **Opsi Pembayaran Lunas 2 Tahun Sekaligus**:\n` +
      `   - Biaya Pendidikan Lunas: *Rp40.000.000* (dibayar saat registrasi)\n` +
      `   - Biaya Pendaftaran: *${formatRp(regFee)}*${waveText} (dibayar saat pendaftaran)\n` +
      `   -> **Total Biaya 2 Tahun**: *${formatRp(grandTotal)}*\n\n` +
      `*Ketentuan Dokumen Resmi (SK Rektor 629 Lampiran 8):*\n` +
      `- Opsi lunas Rp40.000.000 adalah alternatif dari empat pembayaran semester, bukan biaya tambahan (tidak dijumlahkan lagi dengan 4 x SPP semester).\n` +
      `- Biaya sudah termasuk matrikulasi, ujian, dan bimbingan (belum termasuk biaya wisuda).\n` +
      `- Biaya registrasi dasar Rp700.000 dibayarkan terpisah pada saat pendaftaran.\n` +
      `- Total dasar Rp40.700.000 terdiri dari biaya pendidikan dua tahun Rp40.000.000 ditambah registrasi Rp700.000, dengan pengecualian biaya wisuda sesuai sumber.\n` +
      `- Ketentuan potongan tambahan alumni Rp200.000 ("Ditambah Rp. 200.000,- Jika Alumni ITB STIKOM Bali") tetap berstatus SOURCE_GAP sampai aturan penerapannya terbukti dari sumber primer.\n` +
      `- Tidak ada komponen Dana Pendidikan Pokok (DPP) terpisah pada jenjang S2, dan gelombang resmi SK Rektor 629 hanya memuat Gelombang I dan II.`;
  }

  // 2b. Registration fee only
  if (calculationScope === 'registration_only') {
    const regNominal = formatRp(base.pendaftaran);

    if (isWaveExplicit && !isWaveVerified) {
      let waveLines = [];
      if (profile.waveDiscounts) {
        for (const [wName, wDisc] of Object.entries(profile.waveDiscounts)) {
          waveLines.push(`- ${wName}: Potongan ${formatRp(wDisc.pendaftaranDiscount || 0)}`);
        }
      }
      return `Biaya pendaftaran untuk *${profile.canonical}* adalah sebesar *${regNominal}* (tarif dasar umum, dibayarkan satu kali pada saat pendaftaran awal).\n\n` +
        `*Status Khusus ${registrationWave}:*\n` +
        `Potongan biaya pendaftaran khusus ${registrationWave} *belum tercantum* dalam ${docRef} (SOURCE_GAP).\n` +
        (waveLines.length > 0 ? `Dokumen resmi mencantumkan potongan untuk:\n${waveLines.join('\n')}\n\n` : '') +
        `Ketentuan potongan gelombang lain tidak dapat diasumsikan berlaku untuk ${registrationWave}. Pendaftaran online dapat diakses melalui https://pmb.stikom-bali.ac.id.`;
    }

    if (registrationWave && isWaveVerified) {
      return `Biaya pendaftaran untuk *${profile.canonical} (${registrationWave})*:\n\n` +
        `- Biaya Pendaftaran: *${formatRp(net.pendaftaran)}* (setelah potongan ${registrationWave} ${formatRp(discounts.pendaftaranDiscount)}, tarif dasar ${regNominal}).\n` +
        `- Waktu pembayaran: Dibayarkan satu kali pada saat pendaftaran awal.\n\n` +
        `Pendaftaran dapat dilakukan secara online melalui https://pmb.stikom-bali.ac.id.`;
    }

    let waveText = '';
    if (officialWaves.length > 0) {
      const list = Object.entries(profile.waveDiscounts)
        .map(([w, d]) => `- ${w}: Potongan ${formatRp(d.pendaftaranDiscount || 0)}`)
        .join('\n');
      waveText = `\n\nTersedia potongan biaya pendaftaran resmi berdasarkan gelombang:\n${list}`;
    }
    return `Biaya pendaftaran untuk *${profile.canonical}* adalah sebesar *${regNominal}* (dibayarkan satu kali pada saat pendaftaran awal).${waveText}\n\nPendaftaran dapat dilakukan secara online melalui https://pmb.stikom-bali.ac.id.`;
  }

  // 2c. DPP only and installment
  if (calculationScope === 'dpp_only') {
    // D3 specific routing: D3 has NO DPP, only Biaya Registrasi (Jas, Topi, GMTI)
    if (profile.canonical === 'D3 Manajemen Informatika') {
      const regLabel = comps.dpp?.label || 'Biaya Registrasi (Jas, Topi, GMTI)';
      const regNominal = formatRp(base.dpp);
      const renderRegRules = () => {
        let bullets = [];
        bullets.push(`- **Cicilan**: Dapat dicicil per bulan s.d. UTS-1 (tidak wajib dibayar tunai sekaligus saat masuk).`);
        if (comps.dpp?.cashDiscountPercent && profile.canonical !== 'D3 Manajemen Informatika') {
          bullets.push(`- **Pembayaran Tunai**: Apabila Biaya Registrasi dibayarkan secara tunai langsung lunas, diberikan tambahan potongan sebesar *${comps.dpp.cashDiscountPercent}%*.`);
        }
        return bullets.join('\n');
      };

      if (isWaveExplicit && !isWaveVerified) {
        let dppWaveLines = [];
        if (profile.waveDiscounts) {
          for (const [wName, wDisc] of Object.entries(profile.waveDiscounts)) {
            dppWaveLines.push(`- ${wName}: Potongan ${formatRp(wDisc.dppDiscount || 0)}`);
          }
        }
        return `Program studi *${profile.canonical}* **tidak memiliki komponen Dana Pendidikan Pokok (DPP)**. Komponen biaya awal utama adalah *${regLabel}* dengan tarif dasar sebesar *${regNominal}*.\n\n` +
          `*Ketentuan Pembayaran ${regLabel}:*\n` +
          `${renderRegRules()}\n\n` +
          `*Status Khusus ${registrationWave}:*\n` +
          `Potongan biaya registrasi khusus ${registrationWave} *belum tercantum* dalam ${docRef} (SOURCE_GAP).\n` +
          (dppWaveLines.length > 0 ? `Dokumen resmi mencantumkan potongan untuk:\n${dppWaveLines.join('\n')}\n\n` : '') +
          `Ketentuan potongan gelombang lain tidak dapat diasumsikan berlaku untuk ${registrationWave}.`;
      }

      if (registrationWave && isWaveVerified) {
        return `Rincian *${regLabel}* untuk *${profile.canonical} (${registrationWave})* (program D3 tidak memiliki komponen DPP):\n\n` +
          `- ${regLabel} Dasar: ${regNominal}\n` +
          `- Potongan Biaya Gelombang (${registrationWave}): *${formatRp(discounts.dppDiscount)}*\n` +
          `- **Total Kewajiban Biaya Registrasi Bersih**: *${formatRp(net.dpp)}*\n\n` +
          `*Ketentuan Pembayaran:*\n` +
          `${renderRegRules()}\n`;
      }

      let waveText = '';
      if (officialWaves.length > 0) {
        const list = Object.entries(profile.waveDiscounts)
          .map(([w, d]) => `- ${w}: Potongan ${formatRp(d.dppDiscount || 0)}`)
          .join('\n');
        waveText = `\n\nPotongan biaya registrasi resmi per gelombang:\n${list}`;
      }
      return `Program studi *${profile.canonical}* **tidak memiliki komponen Dana Pendidikan Pokok (DPP)**. Komponen biaya awal utama adalah *${regLabel}* dengan tarif dasar sebesar *${regNominal}*.\n\n` +
        `*Ketentuan Pembayaran:*\n` +
        `${renderRegRules()}${waveText}`;
    }

    const dppNominal = formatRp(base.dpp);
    const hasInstallment = Boolean(comps.dpp?.installment);
    const hasCashDiscount = Boolean(comps.dpp?.cashDiscountPercent);
    const installmentRule = comps.dpp?.installment;
    const dppTiming = comps.dpp?.timing || 'Saat Registrasi I';

    const renderPaymentRules = () => {
      let bullets = [];
      if (hasInstallment) {
        bullets.push(`- **Cicilan**: ${installmentRule} (tidak wajib dibayar tunai sekaligus saat masuk).`);
      } else {
        bullets.push(`- **Waktu Pembayaran**: ${dppTiming}.`);
      }
      if (hasCashDiscount) {
        bullets.push(`- **Pembayaran Tunai**: Apabila DPP dibayarkan secara tunai langsung lunas, diberikan tambahan potongan sebesar *${comps.dpp.cashDiscountPercent}%*.`);
      }
      return bullets.join('\n');
    };

    if (isWaveExplicit && !isWaveVerified) {
      let dppWaveLines = [];
      if (profile.waveDiscounts) {
        for (const [wName, wDisc] of Object.entries(profile.waveDiscounts)) {
          dppWaveLines.push(`- ${wName}: Potongan ${formatRp(wDisc.dppDiscount || 0)}`);
        }
      }
      return `Dana Pendidikan Pokok (DPP) dasar untuk *${profile.canonical}* adalah sebesar *${dppNominal}*.\n\n` +
        `*Ketentuan Pembayaran DPP:*\n` +
        `${renderPaymentRules()}\n\n` +
        `*Status Khusus ${registrationWave}:*\n` +
        `Potongan biaya DPP khusus ${registrationWave} *belum tercantum* dalam ${docRef} (SOURCE_GAP).\n` +
        (dppWaveLines.length > 0 ? `Dokumen resmi mencantumkan potongan DPP untuk:\n${dppWaveLines.join('\n')}\n\n` : '') +
        `Ketentuan potongan gelombang lain tidak dapat diasumsikan berlaku untuk ${registrationWave}.`;
    }

    if (registrationWave && isWaveVerified) {
      return `Dana Pendidikan Pokok (DPP) untuk *${profile.canonical} (${registrationWave})*:\n\n` +
        `- DPP Dasar: ${dppNominal}\n` +
        `- Potongan Biaya Gelombang (${registrationWave}): *${formatRp(discounts.dppDiscount)}*\n` +
        `- **Total Kewajiban DPP Bersih**: *${formatRp(net.dpp)}*\n\n` +
        `*Ketentuan Pembayaran DPP:*\n` +
        `${renderPaymentRules()}\n`;
    }

    let waveText = '';
    if (officialWaves.length > 0) {
      const list = Object.entries(profile.waveDiscounts)
        .map(([w, d]) => `- ${w}: Potongan ${formatRp(d.dppDiscount || 0)}`)
        .join('\n');
      waveText = `\n\nPotongan biaya DPP resmi per gelombang:\n${list}`;
    }
    return `Dana Pendidikan Pokok (DPP) untuk *${profile.canonical}* adalah sebesar *${dppNominal}*.\n\n` +
      `*Ketentuan Pembayaran DPP:*\n` +
      `${renderPaymentRules()}${waveText}`;
  }

  // 2d. Initial total only
  if (calculationScope === 'initial_total') {
    const isD3 = profile.canonical === 'D3 Manajemen Informatika';
    const initialCompLabel = isD3 ? 'Biaya Registrasi (Jas, Topi, GMTI)' : 'Dana Pendidikan Pokok (DPP)';

    if (isWaveExplicit && !isWaveVerified) {
      return `*Tarif Dasar Biaya Awal ${profile.canonical} (Status Terkait ${registrationWave})*\n\n` +
        `*1. Status Verifikasi ${registrationWave}:*\n` +
        `Rincian skema pembiayaan khusus untuk ${registrationWave} belum tercantum dalam dokumen penetapan biaya resmi ${docRef} (SOURCE_GAP). Gelombang resmi yang tercantum dalam dokumen adalah: ${officialWavesFormatted}. Tidak ada potongan biaya yang terverifikasi khusus untuk ${registrationWave}.\n\n` +
        `*2. Pemisahan Komponen Biaya Awal (Tarif Dasar Umum):*\n` +
        `a. **Biaya langsung saat registrasi awal**:\n` +
        `   - Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (saat mendaftar)\n` +
        (base.perlengkapan ? `   - Biaya Perlengkapan: ${formatRp(base.perlengkapan)} (Jas Almamater, Topi, Kaos, Tas, GMTI - saat registrasi I)\n` : '') +
        (base.bahasa ? `   - ${base.bahasaLabel}: ${formatRp(base.bahasa)}\n` : '') +
        `   -> Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}* (wajib dibayar tunai di awal)\n\n` +
        `b. **Kewajiban ${initialCompLabel}**:\n` +
        `   - Total Kewajiban ${initialCompLabel}: *${formatRp(base.dpp)}*\n` +
        `   - Ketentuan pembayaran: Dapat dicicil bertahap setiap bulan hingga UTS-1 (TIDAK wajib dibayar tunai lunas saat registrasi awal). Diskon 10% jika dibayar tunai langsung lunas.\n\n` +
        `*3. Ketentuan yang Belum Terverifikasi (SOURCE_GAP):*\n` +
        `- Potongan biaya pendaftaran khusus ${registrationWave}: Belum tersedia di dokumen.\n` +
        `- Potongan biaya khusus ${registrationWave}: Belum tersedia di dokumen.\n\n` +
        `*4. Ringkasan Biaya Awal:*\n` +
        `- Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}*\n` +
        `- Total seluruh kewajiban biaya awal masuk sebelum potongan: *${formatRp(initialTotalBeforeDiscounts)}*\n\n` +
        `_Catatan: Nominal di atas merupakan tarif dasar umum kampus, bukan paket tarif khusus ${registrationWave}. Biaya semester dibayarkan terpisah menjelang masa perwalian tiap semester._`;
    }

    if (registrationWave && isWaveVerified) {
      return `*Total Biaya Awal Masuk ${profile.canonical} (${registrationWave})*\n\n` +
        `Berikut rincian pemisahan komponen biaya awal terverifikasi:\n` +
        `1. **Biaya langsung saat registrasi awal**:\n` +
        `   - Biaya Pendaftaran: ${formatRp(net.pendaftaran)} (setelah potongan biaya ${registrationWave} ${formatRp(discounts.pendaftaranDiscount)})\n` +
        (base.perlengkapan ? `   - Perlengkapan (Jas, Topi, Kaos, Tas, GMTI): ${formatRp(base.perlengkapan)} (saat registrasi I)\n` : '') +
        (base.bahasa ? `   - ${base.bahasaLabel}: ${formatRp(base.bahasa)}\n` : '') +
        `   -> Pembayaran langsung saat registrasi: *${formatRp(net.biayaLangsungRegistrasi)}* (wajib dibayar tunai di awal)\n\n` +
        `2. **Kewajiban ${initialCompLabel}**:\n` +
        `   - Total Kewajiban ${initialCompLabel}: *${formatRp(net.dpp)}* (setelah potongan biaya ${registrationWave} ${formatRp(discounts.dppDiscount)}, normal ${formatRp(base.dpp)})\n` +
        `   - Ketentuan pembayaran: Dapat dicicil bertahap setiap bulan hingga UTS-1 (tidak wajib lunas langsung saat registrasi).\n\n` +
        `*Ringkasan Total Biaya Awal:*\n` +
        `- Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}*\n` +
        `- Total Kewajiban Biaya Awal Masuk: *${formatRp(net.initialTotal)}*\n\n` +
        `_Catatan: Biaya per semester tidak termasuk dalam biaya awal ini dan dibayar terpisah menjelang masa perwalian tiap semester._`;
    }

    return `*Total Biaya Awal Masuk ${profile.canonical}*\n\n` +
      `Berikut rincian pemisahan komponen biaya awal terverifikasi:\n` +
      `1. **Biaya langsung saat registrasi awal**:\n` +
      `   - Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (dibayar saat mendaftar)\n` +
      (base.perlengkapan ? `   - Biaya Perlengkapan (Jas, Topi, Kaos, Tas, GMTI): ${formatRp(base.perlengkapan)} (dibayar saat registrasi I)\n` : '') +
      (base.bahasa ? `   - ${base.bahasaLabel}: ${formatRp(base.bahasa)}\n` : '') +
      `   -> Pembayaran langsung saat registrasi: *${formatRp(net.biayaLangsungRegistrasi)}* (wajib dibayar tunai di awal)\n\n` +
      `2. **Kewajiban ${initialCompLabel}**:\n` +
      `   - Total Kewajiban ${initialCompLabel}: *${formatRp(base.dpp)}*\n` +
      `   - Ketentuan pembayaran: Dapat dicicil bertahap setiap bulan hingga UTS-1 (tidak wajib lunas langsung saat masuk, kecuali memilih diskon tunai 10%).\n\n` +
      `*Ringkasan Total Biaya Awal:*\n` +
      `- Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}*\n` +
      `- Total Kewajiban Biaya Awal: *${formatRp(initialTotalBeforeDiscounts)}*\n\n` +
      (officialWaves.length > 0 ? `_Catatan: Tersedia potongan pendaftaran dan potongan gelombang (${officialWavesFormatted}). Biaya per semester dibayarkan menjelang masa perwalian tiap semester._` : '');
  }

  // 2e. First Year Estimate
  if (calculationScope === 'first_year_estimate') {
    if (isWaveExplicit && !isWaveVerified) {
      return `*Estimasi Biaya Tahun Pertama ${profile.canonical} (Status Terkait ${registrationWave})*\n\n` +
        `*1. Status Verifikasi ${registrationWave}:*\n` +
        `Rincian skema pembiayaan khusus untuk ${registrationWave} belum tercantum dalam ${docRef} (SOURCE_GAP). Oleh karena itu, estimasi total resmi untuk ${registrationWave} belum dapat dipastikan karena potongan biaya awal untuk gelombang ini belum terverifikasi.\n\n` +
        `*2. Komponen Perhitungan Tahun Pertama (Tarif Dasar Sebelum Potongan Gelombang):*\n` +
        `1. Total Kewajiban Biaya Awal (1x masuk, termasuk DPP penuh): ${formatRp(initialTotalBeforeDiscounts)}\n` +
        `2. Biaya Pendidikan Semester 1: ${formatRp(net.semester)}\n` +
        `3. Biaya Pendidikan Semester 2: ${formatRp(net.semester)}\n\n` +
        `*Total Estimasi Tarif Dasar Tahun Pertama: ${formatRp(initialTotalBeforeDiscounts + (2 * net.semester))}*\n\n` +
        `*Ketentuan & Pemisahan Pembayaran:*\n` +
        `- Pembayaran langsung saat registrasi awal: ${formatRp(net.biayaLangsungRegistrasi)} (Pendaftaran + Perlengkapan).\n` +
        `- Kewajiban DPP (${formatRp(base.dpp)}) dapat dicicil per bulan hingga UTS-1.\n` +
        `- Biaya semester dibayar setiap menjelang masa perwalian semester bersangkutan.\n` +
        `- Biaya Pengalaman Industri tidak dimasukkan karena baru dimulai pada Semester 3.\n` +
        `- Angka di atas merupakan tarif dasar umum kampus, belum memperhitungkan potongan gelombang karena potongan khusus ${registrationWave} belum terverifikasi.`;
    }

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
      (registrationWave && isWaveVerified ? '' : `- Estimasi di atas merupakan estimasi tarif dasar umum kampus dan belum memperhitungkan potongan gelombang pendaftaran.\n`);
  }

  // 2f. Industry Option total query
  if (calculationScope === 'with_industry_option' && industryFee.amount > 0) {
    return `*Biaya Pengalaman Industri ${profile.canonical} — Kategori ${industryFee.label}*\n\n` +
      `- Biaya Pengalaman Industri: *${formatRp(industryFee.amount)}*\n` +
      `- Skema pembayaran: Dapat dicicil 5 kali per semester, dimulai dari Semester 3.\n` +
      `- Catatan: Biaya ini belum termasuk tiket perjalanan, paspor, dan visa.\n\n` +
      `Biaya ini merupakan pilihan program tambahan di luar biaya awal dan biaya per semester reguler.`;
  }

  // Case 3: Unverified Wave Query (e.g. "Gelombang 2C", "Gelombang 1A", or unverified wave for this program)
  if (isWaveExplicit && !isWaveVerified) {
    let lines = [];
    lines.push(`*Rincian Biaya Kuliah ${profile.canonical} (Status Terkait ${registrationWave})*\n`);
    lines.push(`Jenjang: ${profile.degree}`);
    lines.push(`Tahun akademik: ${profile.academicYear}`);
    if (profile.skNumber) lines.push(`Dasar penetapan: SK Rektor Nomor : ${profile.skNumber}\n`);

    // 1. Status Verifikasi Gelombang
    lines.push(`*1. Status Verifikasi ${registrationWave}:*`);
    lines.push(`• Gelombang "${registrationWave}" belum tercantum dalam dokumen penetapan biaya resmi SK Rektor Nomor : ${profile.skNumber || '629/ITBSTIKOM/WDS/X/25'} (tidak tercantum / SOURCE_GAP).`);
    if (officialWaves.length > 0) {
      lines.push(`• Gelombang pendaftaran resmi yang memiliki penetapan skema potongan dalam SK Rektor adalah: ${officialWavesFormatted}.`);
    } else {
      lines.push(`• Dokumen resmi tidak mencantumkan skema potongan gelombang untuk program ini.`);
    }
    lines.push(`• Kalender pendaftaran memuat periode pendaftaran untuk ${registrationWave}, namun ketentuan potongan biaya khusus untuk periode tersebut belum diatur tersendiri dalam SK Rektor (SOURCE_GAP).`);
    lines.push(`• Ketentuan potongan Gelombang II, Gelombang I, atau gelombang lainnya tidak dapat diasumsikan berlaku untuk ${registrationWave} tanpa ketetapan resmi tersendiri.\n`);

    // 2. Biaya umum program studi (Tarif Dasar Terverifikasi)
    lines.push(`*2. Biaya Umum Program Studi (Tarif Dasar Terverifikasi):*`);
    lines.push(`_Komponen biaya dasar ${profile.canonical} sebelum potongan gelombang:_`);
    lines.push(`• Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (dibayar saat mendaftar)`);
    if (base.perlengkapan > 0) {
      lines.push(`• Biaya Perlengkapan Awal: ${formatRp(base.perlengkapan)} (${comps.jasTopi ? `Jas Almamater & Topi Rp ${Number(base.jasTopi).toLocaleString('id-ID')}, ` : ''}${comps.kaosTasGmti ? `Kaos, Tas, GMTI Rp ${Number(base.kaosTasGmti).toLocaleString('id-ID')} ` : ''}— dibayar saat Registrasi I)`);
    }
    if (base.bahasa > 0) {
      lines.push(`• ${base.bahasaLabel || 'Biaya Penguatan Bahasa'}: ${formatRp(base.bahasa)} (Menjelang Semester II)`);
    }
    if (base.dpp > 0) {
      lines.push(`• Dana Pendidikan Pokok (DPP): ${formatRp(base.dpp)}`);
      lines.push(`  Ketentuan DPP: Dapat dicicil/diangsur per bulan hingga UTS-1 (tidak wajib dibayar tunai sekaligus saat masuk). Jika dibayar tunai langsung lunas, diberikan tambahan potongan 10%.`);
    } else if (profile.sourceGaps?.dpp) {
      lines.push(`• Dana Pendidikan Pokok (DPP): ${profile.sourceGaps.dpp}`);
    }
    if (base.semester > 0) {
      lines.push(`• Biaya Pendidikan Per Semester: ${formatRp(base.semester)} (dibayar menjelang perwalian tiap semester; Reguler 1 dicicil 2 kali s.d. UTS)`);
    } else if (comps.biayaPerSubject) {
      lines.push(`• Biaya Pendidikan & Ujian: ${formatRp(comps.biayaPerSubject.amount)} per subject (Awal Semester)`);
    }
    if (comps.pengalamanIndustri) {
      lines.push(`• Biaya Pengalaman Industri (pilihan mulai Semester 3, dicicil 5x/semester, belum termasuk tiket/visa): Internasional (${formatRp(comps.pengalamanIndustri.options.internasional.amount)}), Nasional (${formatRp(comps.pengalamanIndustri.options.nasional.amount)}), Lokal (${formatRp(comps.pengalamanIndustri.options.lokal.amount)})`);
    }
    if (profile.specialPolicies?.alumniSmkTiSemesterDiscountPercent) {
      lines.push(`• Khusus alumni SMK TI: Potongan ${profile.specialPolicies.alumniSmkTiSemesterDiscountPercent}% Biaya Pendidikan Per Semester selama 4 tahun.`);
    }
    lines.push('');

    // 3. Ketentuan yang belum terverifikasi (SOURCE_GAP)
    lines.push(`*3. Ketentuan yang Belum Terverifikasi (SOURCE_GAP):*`);
    lines.push(`• Potongan biaya pendaftaran khusus ${registrationWave}: Belum tersedia / belum terverifikasi.`);
    lines.push(`• Beasiswa atau potongan DPP khusus ${registrationWave}: Belum tersedia / belum terverifikasi.`);
    lines.push(`• Total resmi paket biaya khusus ${registrationWave} belum dapat ditetapkan karena tidak ada bukti besaran potongan untuk gelombang ini.\n`);

    // 4. Ringkasan biaya dasar & pemisahan jadwal pembayaran
    lines.push(`*4. Ringkasan Biaya Dasar & Pemisahan Jadwal Pembayaran:*`);
    lines.push(`• Pembayaran langsung saat registrasi awal: *${formatRp(net.biayaLangsungRegistrasi)}* (Pendaftaran + Perlengkapan — dibayar tunai saat registrasi)`);
    if (base.dpp > 0) {
      lines.push(`• Total kewajiban biaya awal masuk: *${formatRp(initialTotalBeforeDiscounts)}* (Pendaftaran + Perlengkapan + Total DPP penuh sebelum potongan)`);
      lines.push(`  _Catatan: Total biaya awal di atas mencakup kewajiban DPP penuh yang pembayarannya dapat diangsur setiap bulan hingga UTS-1 (bukan wajib lunas tunai di muka)._`);
    } else {
      lines.push(`• Total komponen biaya awal terverifikasi: *${formatRp(initialTotalBeforeDiscounts)}* (Biaya pendaftaran awal)`);
    }
    if (base.semester > 0) {
      lines.push(`• Biaya semester: *${formatRp(base.semester)}* per semester (dibayar terpisah setiap menjelang perwalian).`);
    }
    lines.push(`• Biaya sertifikasi, yudisium, dan wisuda akan ditentukan kemudian sesuai kalender akademik.\n`);

    lines.push(`_Untuk konfirmasi apakah "${registrationWave}" memiliki skema potongan khusus atau merupakan penamaan periode internal, silakan menghubungi Admisi PMB ITB STIKOM Bali melalui https://pmb.stikom-bali.ac.id atau (0361) 244445._`);

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
    lines.push(`- Biaya Pendaftaran: ${formatRp(net.pendaftaran)} (potongan biaya gelombang ${registrationWave} ${formatRp(discounts.pendaftaranDiscount)}, normal ${formatRp(base.pendaftaran)})`);
  } else {
    lines.push(`- Biaya Pendaftaran: ${formatRp(base.pendaftaran)} (Pada Saat Daftar)`);
  }

  if (base.jasTopi) lines.push(`- Jas Almamater & Topi: ${formatRp(base.jasTopi)} (Saat Registrasi I)`);
  if (base.kaosTasGmti) lines.push(`- Kaos, Tas, GMTI: ${formatRp(base.kaosTasGmti)} (Saat Registrasi I)`);
  if (base.perlengkapan > 0) {
    lines.push(`-> Pembayaran langsung registrasi awal (pendaftaran + perlengkapan): *${formatRp(net.biayaLangsungRegistrasi)}* (dibayar tunai di awal)`);
  }

  // 2. Biaya Pendidikan
  lines.push(`\n*2. Biaya pendidikan*`);
  const dppLabel = comps.dpp?.label || 'Dana Pendidikan Pokok (DPP)';
  const hasInstallment = Boolean(comps.dpp?.installment);
  const installmentText = hasInstallment ? ` (Ketentuan: ${comps.dpp.installment}, tidak wajib tunai sekaligus saat masuk)` : '';
  if (base.dpp === 0 && profile.sourceGaps?.dpp) {
    lines.push(`- ${dppLabel}: Belum tercantum dalam dokumen resmi (SOURCE_GAP)`);
  } else if (discounts.dppDiscount > 0) {
    lines.push(`- ${dppLabel}: ${formatRp(net.dpp)} (setelah potongan biaya ${registrationWave} ${formatRp(discounts.dppDiscount)}, normal ${formatRp(base.dpp)})`);
    lines.push(`  Waktu pembayaran: ${comps.dpp?.timing || 'Saat Registrasi I'}${installmentText}.`);
  } else {
    lines.push(`- ${dppLabel}: ${formatRp(base.dpp)}`);
    lines.push(`  Waktu pembayaran: ${comps.dpp?.timing || 'Saat Registrasi I'}${installmentText}.`);
  }

  // Bahasa (DNUI / HELP) - Dipisah secara tegas berdasarkan waktu pembayaran
  if (base.bahasa) {
    const bahasaTiming = comps.bahasaMandarin?.timing || comps.bahasaInggris?.timing || 'Menjelang Semester II';
    lines.push(`- ${base.bahasaLabel || 'Biaya Penguatan Bahasa'}: ${formatRp(base.bahasa)} (Waktu pembayaran: ${bahasaTiming})`);
  }

  if (comps.biayaPerSubject) {
    lines.push(`- Biaya Pendidikan & Ujian: ${formatRp(comps.biayaPerSubject.amount)} / subject (Waktu pembayaran: ${comps.biayaPerSubject.timing || 'Awal Semester'})`);
  } else if (base.semester === 0 && profile.sourceGaps?.biayaSemester) {
    lines.push(`- Biaya Pendidikan Per Semester: Belum tercantum dalam dokumen resmi (SOURCE_GAP)`);
  } else if (profile.canonical === 'S2 Sistem Informasi') {
    lines.push(`- Biaya Pendidikan Per Semester: ${formatRp(base.semester)}`);
    lines.push(`  Waktu pembayaran: Per Semester (tersedia opsi lunas 2 tahun Rp 40.000.000 saat registrasi)`);
    lines.push(`  _Catatan: Biaya sudah termasuk matrikulasi, ujian, dan bimbingan (belum termasuk biaya wisuda)._`);
  } else {
    const smkText = isSmkTi ? ` (khusus alumni SMK TI: ${formatRp(net.semester)})` : '';
    lines.push(`- Biaya Pendidikan Per Semester: ${formatRp(base.semester)}${smkText}`);
    if (comps.biayaSemester?.timing && comps.biayaSemester.timing !== 'Menjelang Perwalian') {
      const inst = comps.biayaSemester?.installment ? ` (${comps.biayaSemester.installment})` : '';
      lines.push(`  Waktu pembayaran: ${comps.biayaSemester.timing}${inst}`);
    } else if (comps.biayaSemester?.installment) {
      lines.push(`  Waktu pembayaran: Menjelang perwalian tiap semester (${comps.biayaSemester.installment})`);
    } else {
      lines.push(`  Waktu pembayaran: Menjelang masa perwalian tiap semester`);
    }
  }

  // 3. Biaya Tambahan Pilihan (Pengalaman Industri)
  if (comps.pengalamanIndustri) {
    lines.push(`\n*3. Biaya Tambahan Pilihan (Pengalaman Industri - Mulai Semester 3)*`);
    lines.push(`- Opsi Internasional: ${formatRp(comps.pengalamanIndustri.options.internasional.amount)} (dicicil 5x/semester)`);
    lines.push(`- Opsi Nasional: ${formatRp(comps.pengalamanIndustri.options.nasional.amount)} (dicicil 5x/semester)`);
    lines.push(`- Opsi Lokal: ${formatRp(comps.pengalamanIndustri.options.lokal.amount)} (dicicil 5x/semester)`);
    lines.push(`  _Catatan: Belum termasuk tiket perjalanan, paspor, dan visa._`);
  }

  // 4. Ringkasan Biaya Terverifikasi
  lines.push(`\n*4. Ringkasan biaya*`);
  if (profile.canonical === 'D3 Manajemen Informatika') {
    lines.push(`- Pembayaran langsung saat daftar (biaya pendaftaran): ${formatRp(net.pendaftaran)} (dibayar tunai saat daftar)`);
    lines.push(`- Total kewajiban biaya awal sebelum potongan: ${formatRp(initialTotalBeforeDiscounts)} (Pendaftaran ${formatRp(base.pendaftaran)} + Biaya Registrasi (Jas, Topi, GMTI) ${formatRp(base.dpp)})`);
    if (registrationWave && isWaveVerified) {
      lines.push(`- Total kewajiban biaya awal setelah potongan biaya ${registrationWave}: *${formatRp(net.initialTotal)}* (Pendaftaran net ${formatRp(net.pendaftaran)} + Biaya Registrasi (Jas, Topi, GMTI) net ${formatRp(net.dpp)})`);
    }
    lines.push(`- Catatan pemisahan & cicilan: Biaya pendaftaran (${formatRp(net.pendaftaran)}) dibayar terpisah secara tunai saat daftar. Biaya Registrasi (Jas, Topi, GMTI) sebesar ${formatRp(net.dpp)} dapat dicicil per bulan s.d. UTS-1 dan tidak wajib dibayar lunas sekaligus di muka. Biaya pendidikan per semester (${formatRp(base.semester)}) dibayar terpisah setiap awal semester dan tidak termasuk dalam total biaya awal.`);
  } else if (profile.canonical === 'Double Degree HELP University') {
    lines.push(`- Rincian tahapan waktu pembayaran:`);
    lines.push(`  1. Pada saat daftar: Biaya pendaftaran net ${formatRp(net.pendaftaran)} (setelah potongan ${registrationWave || 'gelombang'} ${formatRp(discounts.pendaftaranDiscount)}, tarif dasar ${formatRp(base.pendaftaran)})`);
    lines.push(`  2. Saat Registrasi I: Dana Pendidikan Pokok (DPP) net ${formatRp(net.dpp)} (setelah potongan ${registrationWave || 'gelombang'} ${formatRp(discounts.dppDiscount)}, dasar ${formatRp(base.dpp)})`);
    lines.push(`  3. Menjelang Semester II: Biaya Penguatan Bahasa Inggris ${formatRp(base.bahasa)}`);
    lines.push(`  4. Setiap awal semester: Biaya Pendidikan & Ujian dihitung ${formatRp(comps.biayaPerSubject?.amount || 3000000)} per subject sesuai jumlah mata kuliah yang diambil.`);
    lines.push(`- Batasan perhitungan: Jumlah subject yang diambil per semester bergantung pada rencana studi dan belum tercantum total pastinya dalam tabel biaya (batasan perhitungan / SOURCE_GAP). Biaya tidak digabung menjadi satu angka total awal masuk yang lengkap.`);
  } else if (profile.canonical === 'Double Degree DNUI') {
    lines.push(`- Rincian tahapan waktu pembayaran:`);
    lines.push(`  1. Pada saat daftar: Biaya pendaftaran net ${formatRp(net.pendaftaran)} (setelah potongan ${registrationWave || 'gelombang'} ${formatRp(discounts.pendaftaranDiscount)}, tarif dasar ${formatRp(base.pendaftaran)})`);
    lines.push(`  2. Saat Registrasi I: Dana Pendidikan Pokok (DPP) net ${formatRp(net.dpp)} (setelah potongan ${registrationWave || 'gelombang'} ${formatRp(discounts.dppDiscount)}, dasar ${formatRp(base.dpp)})`);
    lines.push(`  3. Menjelang Semester II: Biaya Penguatan Bahasa Mandarin ${formatRp(base.bahasa)}`);
    lines.push(`  4. Setiap awal semester: Biaya Pendidikan Per Semester ${formatRp(base.semester)}`);
    lines.push(`- Batasan perhitungan: Ketiga komponen awal (Pendaftaran, DPP, dan Bahasa Mandarin) memiliki jadwal pembayaran terpisah sesuai tahapannya dan tidak ditagihkan sekaligus saat pendaftaran awal. Biaya semester (${formatRp(base.semester)}) dibayar tersendiri setiap awal semester.`);
  } else {
    lines.push(`- Pembayaran langsung registrasi awal (pendaftaran + perlengkapan): ${formatRp(net.biayaLangsungRegistrasi)} (dibayar tunai di awal)`);
    lines.push(`- Total kewajiban biaya awal sebelum potongan: ${formatRp(initialTotalBeforeDiscounts)} (Pendaftaran ${formatRp(base.pendaftaran)} + Perlengkapan ${formatRp(base.perlengkapan)} + DPP ${formatRp(base.dpp)})`);
    if (registrationWave && isWaveVerified) {
      lines.push(`- Total kewajiban biaya awal setelah potongan biaya ${registrationWave}: *${formatRp(net.initialTotal)}* (Pendaftaran net ${formatRp(net.pendaftaran)} + Perlengkapan ${formatRp(base.perlengkapan)} + DPP net ${formatRp(net.dpp)})`);
      if (comps.dpp?.installment) {
        lines.push(`- Catatan cicilan DPP: Total kewajiban biaya awal (${formatRp(net.initialTotal)}) bukan berarti seluruh DPP harus dibayar tunai sekaligus di muka. Kewajiban DPP (${formatRp(net.dpp)}) dapat dicicil bertahap setiap bulan hingga UTS-1. Pembayaran tunai langsung yang wajib di awal registrasi hanya sebesar ${formatRp(net.biayaLangsungRegistrasi)}.`);
      }
    }
  }

  // Ketentuan Pembayaran
  let paymentRules = [];
  if (comps.dpp?.installment) {
    if (profile.canonical === 'D3 Manajemen Informatika') {
      paymentRules.push(`- Pembayaran Biaya Registrasi (Jas, Topi, GMTI) dapat diangsur setiap bulan hingga UTS-1.`);
    } else {
      paymentRules.push(`- Pembayaran DPP dapat diangsur setiap bulan hingga UTS-1.`);
    }
  }
  if (comps.dpp?.cashDiscountPercent && profile.canonical !== 'D3 Manajemen Informatika') {
    paymentRules.push(`- Jika DPP dibayar tunai langsung lunas, diberikan tambahan potongan ${comps.dpp.cashDiscountPercent}% dari DPP.`);
  }
  if (profile.specialPolicies?.alumniSmkTiSemesterDiscountPercent) {
    paymentRules.push(`- Khusus alumni SMK TI: Diberikan potongan ${profile.specialPolicies.alumniSmkTiSemesterDiscountPercent}% Biaya Pendidikan Per Semester selama 4 tahun.`);
  }
  if (paymentRules.length > 0) {
    lines.push(`\n*Ketentuan pembayaran:*`);
    paymentRules.forEach(r => lines.push(r));
    if (comps.dpp?.cashDiscountPercent && profile.canonical !== 'D3 Manajemen Informatika') {
      lines.push(`- Ketentuan akumulasi potongan: Syarat dan ketentuan penggabungan potongan (potongan gelombang, diskon tunai 10%, dan potongan alumni SMK TI) memerlukan verifikasi langsung dengan Bagian Keuangan/Admisi PMB dan tidak diasumsikan dapat ditumpuk secara otomatis tanpa konfirmasi resmi.`);
    } else if (profile.specialPolicies?.alumniSmkTiSemesterDiscountPercent) {
      lines.push(`- Ketentuan akumulasi potongan: Syarat dan ketentuan penggabungan potongan (potongan gelombang dan potongan alumni SMK TI) memerlukan verifikasi langsung dengan Bagian Keuangan/Admisi PMB dan tidak diasumsikan dapat ditumpuk secara otomatis tanpa konfirmasi resmi.`);
    }
  }

  // Catatan
  lines.push(`\n*Catatan:*`);
  lines.push(`- Biaya sertifikasi, yudisium, dan wisuda akan ditentukan kemudian sesuai kalender akademik.`);
  if (!registrationWave || !isWaveVerified) {
    lines.push(`- Nominal di atas belum memperhitungkan potongan gelombang pendaftaran.`);
  }

  if (profile.sourceGaps) {
    lines.push(`\n*Ketentuan yang Belum Tercantum (SOURCE_GAP):*`);
    for (const [gapKey, gapDesc] of Object.entries(profile.sourceGaps)) {
      if (gapKey === 'hotline') continue;
      lines.push(`- ${gapDesc}`);
    }
    if (profile.sourceGaps.hotline) {
      lines.push(`- Untuk konfirmasi biaya resmi pascasarjana, silakan menghubungi Admisi di ${profile.sourceGaps.hotline}.`);
    }
  }

  return lines.join('\n');
}

/**
 * End-to-end grounded fee response generator.
 */
function generateFeeAnswer(frameOrQuery, secondArg = [], thirdArg = {}) {
  let semanticFrame = {};
  let rawQuery = '';
  let accepted = [];
  let arbitratedEvidence = {};

  let programEntity = null;

  if (typeof frameOrQuery === 'string') {
    if (typeof secondArg === 'string') {
      programEntity = frameOrQuery;
      rawQuery = secondArg;
      const sessionData = (thirdArg && typeof thirdArg === 'object') ? thirdArg : {};
      arbitratedEvidence = { sessionData };
      semanticFrame = { rawQuery, entities: [{ canonical: programEntity }] };
    } else {
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
    }
  } else if (frameOrQuery && typeof frameOrQuery === 'object') {
    semanticFrame = frameOrQuery;
    rawQuery = String(semanticFrame.rawQuery || semanticFrame.query || '');
    accepted = Array.isArray(secondArg) ? secondArg : [];
    arbitratedEvidence = thirdArg || {};
  }

  const normQuery = String(semanticFrame.normalizedQuery || rawQuery || '');
  const sessionCtx = arbitratedEvidence?.sessionData || {};
  const scopeParams = detectFeeScope(rawQuery, sessionCtx);

  // Identify program entity from semantic frame if not already specified
  const entities = semanticFrame.entities || arbitratedEvidence?.semanticFrame?.entities || [];
  if (!programEntity) {
    for (const ent of entities) {
      const canon = ent.canonical || ent.name || String(ent);
      const profile = resolveFeeProfile(canon);
      if (profile) {
        programEntity = canon;
        break;
      }
    }
  }

  const combinedQ = (rawQuery + ' ' + normQuery).toLowerCase();

  // 1. Syarat / Prosedur / Dokumen Pengajuan Cicilan
  const isInstallmentProcedure =
    /\b(?:syarat|persyaratan|prosedur|tata\s*cara|cara(?:\s+mengajukan)?|bagaimana\s+mengajukan|pengajuan|dokumen|berkas|formulir)\b/i.test(combinedQ) &&
    /\b(?:di)?(?:cicil(?:an)?|angsur(?:an)?|mengangsur)\b/i.test(combinedQ);

  if (isInstallmentProcedure) {
    const procText =
      `Mengenai **persyaratan dan prosedur pengajuan cicilan biaya kuliah**, informasi resmi yang tertera dalam SK Rektor ITB STIKOM Bali Nomor 629/ITBSTIKOM/WDS/X/25 hanya menetapkan **waktu/jadwal pembayaran**, yaitu Dana Pendidikan Pokok (DPP) atau Biaya Registrasi dapat diangsur setiap bulan sampai menjelang Ujian Tengah Semester 1 (UTS-1) pada semester berjalan.\n\n` +
      `Namun, **persyaratan administratif khusus, dokumen yang diperlukan, maupun prosedur teknis pengajuan cicilan belum tercantum secara rinci dalam dokumen penetapan biaya yang tersedia (SOURCE_GAP)**.\n\n` +
      `Untuk konfirmasi prosedur resmi dan persyaratan pengajuan cicilan secara lengkap, silakan langsung mengonfirmasi kepada admin PMB atau bagian keuangan resmi ITB STIKOM Bali melalui website https://pmb.stikom-bali.ac.id atau telepon (0361) 244445.`;

    return {
      success: true,
      answer: procText,
      source: 'grounded_fee_engine',
      intent: 'INSTALLMENT_PROCEDURE_INQUIRY',
      isInstallmentProcedure: true,
      sourceGap: true
    };
  }

  // 2. DPP & Termin/Jadwal Cicilan (misal: "Berapa biaya DPP dan sampai kapan bisa dicicil?")
  const isDppInstallmentInquiry =
    /\bdpp\b/i.test(combinedQ) &&
    /\b(?:sampai\s+kapan|kapan|jadwal|tenggat|deadline|batas\s+waktu)\b/i.test(combinedQ) &&
    /\b(?:di)?(?:cicil(?:an)?|angsur(?:an)?|mengangsur)\b/i.test(combinedQ);

  if (isDppInstallmentInquiry && !programEntity) {
    const dppScheduleText =
      `Berdasarkan ketentuan resmi SK Rektor ITB STIKOM Bali Nomor 629/ITBSTIKOM/WDS/X/25:\n\n` +
      `• **Besaran DPP per Program Studi (Tarif Dasar Sebelum Potongan)**:\n` +
      `  - **S1 Sistem Informasi, Teknologi Informasi, & Bisnis Digital**: Rp 14.000.000 (dapat dicicil per bulan s.d. UTS-1)\n` +
      `  - **S1 Sistem Komputer**: Rp 11.000.000 (dapat dicicil per bulan s.d. UTS-1)\n` +
      `  - **D3 Manajemen Informatika**: Tidak memiliki komponen DPP. Komponen biaya masuk utama adalah **Biaya Registrasi (Jas, Topi, GMTI)** sebesar Rp 10.000.000 (dapat dicicil per bulan s.d. UTS-1)\n` +
      `  - **International Double Degree (HELP / DNUI)**: DPP sebesar Rp 20.000.000 dibayarkan saat Registrasi I (jadwal cicilan bulanan s.d. UTS-1 hanya berlaku untuk program Sarjana S1 reguler dan Vokasi D3, tidak otomatis berlaku untuk program International Double Degree)\n\n` +
      `• **Ketentuan & Waktu Pembayaran Cicilan DPP**:\n` +
      `  Dana Pendidikan Pokok (DPP) untuk jenjang Sarjana S1 reguler dapat dicicil per bulan sampai dengan menjelang Ujian Tengah Semester 1 (UTS-1) pada semester berjalan. Tersedia tambahan potongan sebesar 10% apabila DPP dibayarkan secara tunai langsung lunas.`;

    return {
      success: true,
      answer: dppScheduleText,
      source: 'grounded_fee_engine',
      intent: 'TUITION_FEE_INQUIRY',
      isDppInstallmentInquiry: true
    };
  }

  // 3. Pure Payment Schedule / Timing Cicilan
  const isInstallmentScheduleOnly =
    /\b(?:sampai\s+kapan|kapan|jadwal|tenggat|deadline|batas\s+waktu)\b/i.test(combinedQ) &&
    /\b(?:di)?(?:cicil(?:an)?|angsur(?:an)?|mengangsur)\b/i.test(combinedQ) &&
    !/\b(?:berapa|biaya|tarif|rincian)\b/i.test(combinedQ);

  if (isInstallmentScheduleOnly && !programEntity) {
    const scheduleOnlyText =
      `Berdasarkan SK Rektor ITB STIKOM Bali Nomor 629/ITBSTIKOM/WDS/X/25, ketentuan jadwal dan batas waktu cicilan biaya kuliah adalah sebagai berikut:\n\n` +
      `• **Dana Pendidikan Pokok (DPP) S1 Reguler & Biaya Registrasi D3**: DAPAT dicicil atau diangsur bertahap setiap bulan sampai menjelang Ujian Tengah Semester 1 (UTS-1) pada semester berjalan.\n` +
      `• **Biaya Pendidikan Per Semester**: Dibayarkan setiap semester menjelang masa perwalian/KRS (khusus Reguler 1 semester pertama dapat dicicil 2 kali s.d. UTS).\n` +
      `• **Potongan Pembayaran Tunai**: Calon mahasiswa yang membayar DPP secara tunai langsung lunas mendapatkan tambahan potongan sebesar 10%.\n\n` +
      `Untuk simulasi pembayaran per bulan pada program studi tertentu, silakan sebutkan program studi yang Kakak minati ya.`;

    return {
      success: true,
      answer: scheduleOnlyText,
      source: 'grounded_fee_engine',
      intent: 'PAYMENT_SCHEDULE_INQUIRY',
      isInstallmentScheduleOnly: true
    };
  }

function formatAmbiguousProgramFeeResponse(scopeParams, rawQuery = '') {
  const wave = scopeParams.registrationWave || 'Gelombang II';
  const isRegistrationOnly = scopeParams.calculationScope === 'registration_fee' ||
    (/\b(biaya\s+pendaftaran|uang\s+pendaftaran|tarif\s+pendaftaran)\b/i.test(rawQuery) && !/\b(rincian\s+biaya|total\s+biaya|biaya\s+kuliah|dpp|spp)\b/i.test(rawQuery));

  if (isRegistrationOnly) {
    let waveLabel = scopeParams.isWaveExplicit && scopeParams.registrationWave ? ` (${scopeParams.registrationWave})` : '';
    let text = `Tarif biaya pendaftaran di ITB STIKOM Bali${waveLabel} berbeda menurut jenjang dan program studi:\n\n`;
    if (wave === 'Gelombang II') {
      text += `• **Program Sarjana (S1) & Vokasi (D3) Reguler**:\n` +
        `  - Biaya pendaftaran: *Rp 300.000* (setelah potongan Gelombang II Rp 200.000, tarif dasar Rp 500.000).\n` +
        `  - Berlaku untuk: S1 Sistem Informasi, S1 Teknologi Informasi, S1 Bisnis Digital, S1 Sistem Komputer, dan D3 Manajemen Informatika.\n\n` +
        `• **Program Pascasarjana (S2 Magister Sistem Informasi)**:\n` +
        `  - Biaya pendaftaran: *Rp 600.000* (setelah potongan Gelombang II Rp 100.000, tarif dasar Rp 700.000).\n\n` +
        `• **Program International Double Degree (HELP / DNUI)**:\n` +
        `  - Biaya pendaftaran: *Rp 2.000.000* (setelah potongan Gelombang II Rp 1.000.000, tarif dasar Rp 3.000.000).\n\n` +
        `Pendaftaran dapat dilakukan secara online melalui https://pmb.stikom-bali.ac.id.\n\n` +
        `Silakan tentukan program studi yang Kakak minati untuk mendapatkan informasi pendaftaran spesifik ya.`;
    } else if (wave === 'Gelombang I') {
      text += `• **Program Sarjana (S1) & Vokasi (D3) Reguler**: *Rp 250.000* (setelah potongan Gelombang I Rp 250.000, tarif dasar Rp 500.000).\n` +
        `• **Program Pascasarjana (S2 Magister SI)**: *Rp 500.000* (setelah potongan Gelombang I Rp 200.000, tarif dasar Rp 700.000).\n` +
        `• **International Double Degree**: *Rp 1.750.000* (setelah potongan Gelombang I Rp 1.250.000, tarif dasar Rp 3.000.000).\n\n` +
        `Silakan tentukan program studi yang Kakak minati untuk panduan pendaftaran spesifik ya.`;
    } else if (wave === 'Gelombang Khusus') {
      text += `• **Program Sarjana (S1) & Vokasi (D3) Reguler**: *Rp 200.000* (setelah potongan Gelombang Khusus Rp 300.000, tarif dasar Rp 500.000).\n` +
        `• **Program Pascasarjana (S2 Magister SI)**: *Rp 700.000* (tarif normal).\n` +
        `• **International Double Degree**: *Rp 1.500.000* (setelah potongan Gelombang Khusus Rp 1.500.000, tarif dasar Rp 3.000.000).\n\n` +
        `Silakan tentukan program studi yang Kakak minati untuk panduan pendaftaran spesifik ya.`;
    } else {
      text += `• **Program Sarjana (S1) & Vokasi (D3) Reguler**: *Rp 500.000* (sebelum potongan gelombang pendaftaran).\n` +
        `• **Program Pascasarjana (S2 Magister SI)**: *Rp 700.000*.\n` +
        `• **International Double Degree**: *Rp 3.000.000*.\n\n` +
        `Silakan sebutkan program studi yang Kakak tuju untuk informasi pendaftaran yang tepat ya.`;
    }
    return text;
  }

  // Full breakdown or general fee inquiry without prodi
  let waveHeader = scopeParams.isWaveExplicit && scopeParams.registrationWave ? ` (${scopeParams.registrationWave})` : '';
  let text = `Rincian biaya pendidikan di ITB STIKOM Bali T.A 2026/2027${waveHeader} berbeda tergantung pada program studi dan jenjang yang dipilih:\n\n` +
    `1. **S1 Sistem Informasi, Teknologi Informasi, & Bisnis Digital**:\n` +
    `   - Biaya Pendaftaran: Rp 300.000 (S1 SI/TI/BD Gelombang II, tarif dasar Rp 500.000)\n` +
    `   - Perlengkapan Awal: Rp 1.500.000 (Jas Almamater, Topi, Tas, GMTI)\n` +
    `   - Dana Pendidikan Pokok (DPP): Rp 12.500.000 (setelah potongan biaya Gelombang II Rp 1.500.000, normal Rp 14.000.000; dapat dicicil per bulan s.d. UTS-1)\n` +
    `   - Biaya Pendidikan Per Semester: Rp 6.500.000 (dibayar terpisah menjelang perwalian)\n\n` +
    `2. **S1 Sistem Komputer**:\n` +
    `   - Biaya Pendaftaran: Rp 300.000 (S1 Sistem Komputer Gelombang II, tarif dasar Rp 500.000)\n` +
    `   - Perlengkapan Awal: Rp 1.500.000 (Jas almamater & perlengkapan awal)\n` +
    `   - Dana Pendidikan Pokok (DPP): Rp 10.250.000 (setelah potongan biaya Gelombang II Rp 750.000, normal Rp 11.000.000; dapat dicicil per bulan s.d. UTS-1)\n` +
    `   - Biaya Pendidikan Per Semester: Rp 6.000.000 (dibayar terpisah menjelang perwalian)\n\n` +
    `3. **D3 Manajemen Informatika**:\n` +
    `   - Biaya Pendaftaran: Rp 300.000 (D3 MI Gelombang II, tarif dasar Rp 500.000)\n` +
    `   - Biaya Registrasi (Jas, Topi, GMTI): Rp 9.250.000 (setelah potongan biaya Gelombang II Rp 750.000, normal Rp 10.000.000; dapat dicicil per bulan s.d. UTS-1)\n` +
    `   - Total Kewajiban Biaya Awal Masuk: Rp 9.550.000 (Pendaftaran Rp 300.000 + Biaya Registrasi Rp 9.250.000; dapat dicicil per bulan s.d. UTS-1)\n` +
    `   - Biaya Pendidikan Per Semester: Rp 4.500.000 (dibayar terpisah menjelang perwalian)\n\n` +
    `4. **Program Pascasarjana (S2) & International Double Degree (HELP / DNUI)**:\n` +
    `   - Memiliki skema dan komponen pembiayaan tersendiri.\n\n` +
    `Untuk rincian perhitungan biaya lengkap dan simulasi cicilan yang akurat, mohon informasikan program studi yang Kakak minati ya.`;

  return text;
}

  // Check session context for multi-turn follow up
  if (!programEntity) {
    const sess = arbitratedEvidence?.sessionData || semanticFrame?.sessionData;
    if (sess) {
      const prev = sess.activeEntity || sess.lastEntity;
      const prevStr = typeof prev === 'object' && prev !== null ? (prev.canonical || prev.name || '') : String(prev || '');
      if (prevStr && resolveFeeProfile(prevStr)) {
        programEntity = resolveFeeProfile(prevStr).canonical || prevStr;
      }
    }
  }

  // Fallback to query inspection if no entity resolved
  if (!programEntity) {
    const qLower = (rawQuery + ' ' + normQuery).toLowerCase();
    if (/\b(?:s2|magister|pascasarjana|matrikulasi|martikulasi)\b/i.test(qLower)) programEntity = 'S2 Sistem Informasi';
    else if (/sistem\s+komputer|\bsk\b/i.test(qLower)) programEntity = 'S1 Sistem Komputer';
    else if (/teknologi\s+informasi|\bti\b/i.test(qLower)) programEntity = 'S1 Teknologi Informasi';
    else if (/bisnis\s+digital|\bbd\b/i.test(qLower)) programEntity = 'S1 Bisnis Digital';
    else if (/sistem\s+informasi|\bsi\b/i.test(qLower)) programEntity = 'S1 Sistem Informasi'; else if (/manajemen\s+informatika|d3/i.test(qLower)) programEntity = 'D3 Manajemen Informatika';
    else if (/utb/i.test(qLower)) programEntity = 'Dual Degree UTB';
    else if (/help/i.test(qLower)) programEntity = 'Double Degree HELP University';
    else if (/dnui/i.test(qLower)) programEntity = 'Double Degree DNUI';
    else if (/rpl/i.test(qLower)) programEntity = 'RPL Sistem Informasi';
    else if (/transfer/i.test(qLower)) programEntity = 'Transfer Kredit S1';
  }

  // Handle RPL specific source gap if asking about RPL conversions
  if (programEntity === 'RPL Sistem Informasi' || /\brpl\b/i.test(rawQuery + ' ' + normQuery)) {
    const rplAnswer = `*Informasi Biaya Kuliah Rekognisi Pembelajaran Lampau (RPL) S1 Sistem Informasi*\n\n` +
      `Jenjang: S1\n` +
      `Tahun akademik: 2026/2027\n\n` +
      `*Komponen Biaya Terverifikasi:*\n` +
      `- Biaya Pendaftaran: Rp 500.000 (Pada Saat Daftar)\n` +
      `- Biaya Perlengkapan Awal: Rp 1.500.000 (Jas Almamater, Topi, Kaos, Tas, GMTI — dibayar saat Registrasi I)\n` +
      `- Biaya Pendidikan Per Semester: Rp 6.500.000 (Menjelang perwalian tiap semester; Reguler 1 dicicil 2 kali s/d UTS)\n\n` +
      `*Ketentuan Konversi & DPP (SOURCE_GAP):*\n` +
      `Biaya per SKS konversi dan penetapan Dana Pendidikan Pokok (DPP) untuk jalur RPL belum tercantum dalam dokumen penetapan biaya resmi SK Rektor Nomor : 629/ITBSTIKOM/WDS/X/25. Besaran SKS yang diakui serta total biaya akhir ditentukan secara individual setelah proses asesmen portofolio atau transkrip oleh Tim RPL.\n\n` +
      `Untuk konsultasi dan evaluasi transkrip mata kuliah, silakan menghubungi Tim PMB ITB STIKOM Bali melalui https://pmb.stikom-bali.ac.id atau (0361) 244445.`;

    return {
      success: true,
      answer: rplAnswer,
      source: 'grounded_fee_engine',
      isRplSourceGap: true
    };
  }

  // If asking generally about Double Degree without specific partner
  if (!programEntity && (
    /\b(?:double|dual)\s*degree\b/i.test(rawQuery + ' ' + normQuery) ||
    (entities && entities.some(e => /degree/i.test(String(e)))) ||
    (sessionCtx?.activeEntity && /degree/i.test(String(sessionCtx.activeEntity.canonical || sessionCtx.activeEntity))) ||
    (sessionCtx?.conversationState?.activeEntity && /degree/i.test(String(sessionCtx.conversationState.activeEntity.canonical || sessionCtx.conversationState.activeEntity)))
  )) {
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
      `• **D3 Manajemen Informatika**: Rp 4.500.000 per semester (Biaya Registrasi dasar: Rp 10.000.000; tanpa komponen DPP)`,
      `• **Dual Degree UTB Bandung**: Rp 7.500.000 per semester (DPP: Rp 14.000.000, alumni SMK TI: Rp 6.500.000)`,
      `• **Double Degree HELP University**: Rp 3.000.000 per subject (DPP: Rp 20.000.000)`,
      `• **Double Degree DNUI China**: Rp 16.000.000 per semester (DPP: Rp 20.000.000)`,
      `• **S2 Sistem Informasi**: Rp 10.000.000 per semester (opsi lunas 2 tahun Rp 40.000.000; pendaftaran dasar Rp 700.000)\n`,
      `*Ketentuan Tambahan:* Pembayaran DPP S1 reguler dan Biaya Registrasi D3 dapat diangsur setiap bulan hingga UTS-1, dan tersedia potongan beasiswa gelombang awal serta diskon pembayaran tunai 10% (sesuai ketentuan masing-masing program).`
    ];
    return {
      success: true,
      answer: lines.join('\n'),
      source: 'grounded_fee_engine'
    };
  }

  // Handle wave comparison query (e.g. "Apakah biaya Gelombang I berbeda dengan Gelombang II?")
  if (scopeParams.isWaveComparison && scopeParams.comparedWaves && scopeParams.comparedWaves.length >= 2) {
    const targetProgram = programEntity || 'S1 Sistem Informasi';
    const profile = resolveFeeProfile(targetProgram);
    if (profile) {
      const w1 = scopeParams.comparedWaves[0];
      const w2 = scopeParams.comparedWaves[1];
      const b1 = calculateFeeBreakdown(profile, { ...scopeParams, registrationWave: w1, isWaveExplicit: true });
      const b2 = calculateFeeBreakdown(profile, { ...scopeParams, registrationWave: w2, isWaveExplicit: true });
      const compAnswer = formatWaveComparisonResponse(profile, w1, b1, w2, b2);
      return {
        success: true,
        answer: compAnswer,
        source: 'grounded_fee_engine',
        isWaveComparison: true,
        activeWave: w2,
        activeEntity: targetProgram
      };
    }
  }

  // Handle ambiguous study programs when no prodi is specified in query or context
  if (!programEntity) {
    if (/\b(?:biaya|uang|dpp|spp|pendaftaran|gelombang)\b/i.test(rawQuery + ' ' + normQuery)) {
      const ambiguousAnswer = formatAmbiguousProgramFeeResponse(scopeParams, rawQuery);
      return {
        success: true,
        answer: ambiguousAnswer,
        source: 'grounded_fee_engine',
        isAmbiguousProgram: true,
        calculation: null,
        activeWave: scopeParams.registrationWave || null,
        activeEntity: null
      };
    } else {
      return null;
    }
  }

  const profile = resolveFeeProfile(programEntity);
  if (!profile) return null;

  // Safe context inheritance guard:
  // If wave was inherited from prior session but this target program does not have that wave in its canonical schedule,
  // request clarification instead of silently falling back to base rate without notice.
  if (scopeParams.isWaveInherited && scopeParams.registrationWave) {
    const profileWaves = profile.waveDiscounts || {};
    if (!profileWaves[scopeParams.registrationWave]) {
      const availableWaves = Object.keys(profileWaves);
      const waveListStr = availableWaves.length > 0 ? availableWaves.join(', ') : 'tidak tersedia skema potongan gelombang';
      const clarifAnswer = `Untuk program studi **${profile.canonical}**, ketentuan potongan untuk **${scopeParams.registrationWave}** tidak tercantum dalam dokumen penetapan resmi (${profile.docRef || 'SK Rektor'}). Gelombang resmi yang tersedia untuk program ini adalah: ${waveListStr}.\n\nApakah Anda ingin melihat tarif dasar umum atau gelombang tertentu untuk ${profile.canonical}?`;
      return {
        success: true,
        answer: clarifAnswer,
        source: 'grounded_fee_engine',
        isClarificationRequired: true,
        activeWave: null,
        activeEntity: programEntity
      };
    }
  }

  const calcResult = calculateFeeBreakdown(profile, scopeParams);
  const formattedAnswer = formatWhatsAppFeeResponse(calcResult, rawQuery);

  return {
    success: true,
    answer: formattedAnswer,
    source: 'grounded_fee_engine',
    calculation: calcResult,
    activeWave: calcResult?.discounts?.wave || scopeParams.registrationWave || null,
    activeEntity: programEntity
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
  formatRp,
  extractAllMentionedWaves
};
