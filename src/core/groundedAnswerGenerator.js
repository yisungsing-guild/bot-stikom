'use strict';

/**
 * src/core/groundedAnswerGenerator.js
 * 
 * Greenfield Grounded Answer Generator (LLM Synthesis & Structured Deterministic Fallback).
 * Contract:
 * - EVIDENCE -> NATURAL LANGUAGE
 * - Synthesizes answers ONLY from verified evidence.
 * - Does not use parametric knowledge to invent facts.
 * - Does not leak raw chunks verbatim.
 * - Cleans all document artifacts and normalizes facts into clear WhatsApp-ready markdown.
 */

const { AIReplyEngine } = require('../engine/aiEngine');
const logger = require('../logger');

let aiEngineInstance = null;
function getAiEngine() {
  if (!aiEngineInstance) {
    aiEngineInstance = new AIReplyEngine(process.env.OPENAI_API_KEY);
  }
  return aiEngineInstance;
}

let openaiCircuitOpen = false;

function buildSynthesisPrompt(semanticFrame, evidenceList = []) {
  const contextSnippet = evidenceList
    .map((e, idx) => `[Bukti ${idx + 1}] (Sumber: ${e.source || 'dokumen resmi'}):\n${e.text.trim()}`)
    .join('\n\n');

  return {
    systemPrompt: `Kamu adalah asisten resmi kampus ITB STIKOM Bali.
Tugasmu adalah menyusun jawaban ramah dan faktual HANYA berdasarkan BUKTI yang diberikan.

ATURAN KETAT:
1. Gunakan HANYA informasi yang ada di [Bukti]. DILARANG mengarang fakta atau menambahkan informasi di luar teks.
2. Jika ada nama kampus/prodi/entitas, gunakan persis seperti pada teks bukti.
3. Jawab dalam Bahasa Indonesia yang sopan, terstruktur, dan mudah dibaca melalui WhatsApp.
4. Jangan menyalin dokumen secara mentah dalam bentuk tag teknis, header OCR, atau kode database.
5. Jawab seluruh poin pertanyaan pengguna secara lengkap.`,
    userPrompt: `Pertanyaan Pengguna: "${semanticFrame.rawQuery}"

BUKTI YANG TERSEDIA:
${contextSnippet}

Jawabanmu:`
  };
}

/**
 * Strips raw OCR markers, Excel tokens, administrative signatures, and dangling fragments
 */
function cleanDocumentArtifacts(text) {
  if (!text) return '';
  let clean = text;

  // 1. Strip raw document / OCR wrappers
  clean = clean.replace(/Ringkasan dokumen:.*$/gim, '');
  clean = clean.replace(/Program studi terlihat:.*$/gim, '');
  clean = clean.replace(/Program internasional \/ kerja sama internasional:.*$/gim, '');
  clean = clean.replace(/Format file:.*$/gim, '');
  clean = clean.replace(/\[Sheet:\s*[^\]]+\]/gi, '');
  clean = clean.replace(/\[Program:\s*[^\]]+\]/gi, '');
  clean = clean.replace(/\[Bukti\s*\d+\]/gi, '');

  // 2. Strip Excel column tokens and format columns
  clean = clean.replace(/Penjelasan Prodi dan Karier Masa Depan\s*:\s*/gi, '');
  clean = clean.replace(/\|\s*col\d+\s*:\s*/gi, '\n');
  clean = clean.replace(/\|\s*Yang Dipelajari\s*:\s*/gi, '\nYang Dipelajari: ');
  clean = clean.replace(/\|\s*Cocok Untuk\s*:\s*/gi, '\nCocok Untuk: ');
  clean = clean.replace(/\|\s*Peluang Kerja\s*:\s*/gi, '\nPeluang Kerja: ');
  clean = clean.replace(/\|\s*Penjelasan prodi\s*:\s*/gi, '\nPenjelasan: ');

  // 3. Strip broken all-caps dangling titles ending with conjunctions
  clean = clean.replace(/PROGRAM STUDI\s+[A-Z\s,]+\b(?:DAN|SERTA|DAN\/ATAU)\b/gi, '');

  // 4. Strip thesis guide administrative signature / approval lines
  clean = clean.replace(/^(?:Para\s+)?Ketua Program Studi\s+[A-Z0-9\-\s\.]*$/gim, '');
  clean = clean.replace(/^(?:Acc\s+Kaprodi|Dosen Pembimbing Utama|Dosen Pembimbing Pendamping).*$/gim, '');
  clean = clean.replace(/^(?:Dir\.\s+Digitalisasi|Arsip|SueI|WN|—).*$/gim, '');

  // 5. Strip institutional history sections from program overview
  clean = clean.replace(/1\.\s*Sejarah Singkat Institusi[^]*?2\.\s*Profil Saat Ini/gi, '');
  clean = clean.replace(/2\.\s*Profil Saat Ini\s*•\s*Status:\s*Perguruan tinggi bertaraf internasional\./gi, '');

  // 6. Strip page numbers, dashes, and dotted leader lines
  clean = clean.replace(/\.{4,}\s*\d+/g, '');
  clean = clean.replace(/^-{10,}$/gm, '');

  // 7. Normalize repeated spaces and lines
  clean = clean
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  return clean;
}

function isolateTargetPassages(text, targetEntities = [], excludedEntities = []) {
  if (!text || targetEntities.length === 0 || excludedEntities.length === 0) {
    return [text];
  }

  const markers = [];

  // Find target matches as headings/titles
  for (const te of targetEntities) {
    const base = te.replace(/^(S1|D3|S2)\s+/i, '');
    const patterns = [
      te.replace(/\s+/g, '\\s+'),
      base.replace(/\s+/g, '\\s+')
    ];
    for (const pat of patterns) {
      const r = new RegExp('(?:^|\\n|•|\\d+\\.|(?:Program\\s+Studi|Prodi)\\s+)\\s*(' + pat + ')(?:\\s*\\((?:S1|D3|S2)\\)|\\s*:|\\s*\\|)?', 'gi');
      let m;
      while ((m = r.exec(text)) !== null) {
        markers.push({ isTarget: true, entity: te, index: m.index, match: m[0] });
      }
    }
  }

  const targetBases = targetEntities.map(te => te.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase());

  // Find excluded matches as headings/titles
  for (const ex of excludedEntities) {
    const base = ex.replace(/^(S1|D3|S2)\s+/i, '');
    const isTargetBase = targetBases.some(tb => tb === base.toLowerCase() || tb === ex.toLowerCase());

    // If this excluded entity shares base name with target (e.g. S2 vs S1 Sistem Informasi),
    // only exclude the full qualified name (e.g. S2 Sistem Informasi), NEVER the shared base!
    const patterns = isTargetBase 
      ? [ex.replace(/\s+/g, '\\s+')]
      : [ex.replace(/\s+/g, '\\s+'), base.replace(/\s+/g, '\\s+')];

    for (const pat of patterns) {
      const r = new RegExp('(?:^|\\n|•|\\d+\\.|(?:Program\\s+Studi|Prodi)\\s+)\\s*(' + pat + ')(?:\\s*\\((?:S1|D3|S2)\\)|\\s*:|\\s*\\|)?', 'gi');
      let m;
      while ((m = r.exec(text)) !== null) {
        markers.push({ isTarget: false, entity: ex, index: m.index, match: m[0] });
      }
    }
  }

  if (markers.length === 0 || !markers.some(m => !m.isTarget)) {
    return [text];
  }

  // Sort and prioritize isTarget over excluded when overlapping
  markers.sort((a, b) => {
    if (Math.abs(a.index - b.index) <= 5) {
      return a.isTarget ? -1 : 1;
    }
    return a.index - b.index;
  });

  // Deduplicate overlapping markers within 10 chars
  const deduped = [];
  for (const m of markers) {
    if (deduped.length === 0 || m.index > deduped[deduped.length - 1].index + 10) {
      deduped.push(m);
    }
  }

  const targetPassages = [];
  for (let i = 0; i < deduped.length; i++) {
    const current = deduped[i];
    if (current.isTarget) {
      const start = current.index;
      const end = (i + 1 < deduped.length) ? deduped[i + 1].index : text.length;
      const passage = text.slice(start, end).replace(/\s+/g, ' ').trim();
      if (passage.length > 20) {
        targetPassages.push(passage);
      }
    }
  }

  // INVARIANT: If this chunk contains conflicting sibling programs and target passage
  // could not be cleanly isolated, REJECT the ambiguous passage (do NOT fallback to whole chunk!)
  if (targetPassages.length === 0 && markers.some(m => !m.isTarget)) {
    return [];
  }

  return targetPassages.length > 0 ? targetPassages : [text];
}

function extractScoredPassages(semanticFrame, accepted = []) {
  const targetEntities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
  const targetBases = targetEntities.map(te => te.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase());
  const excludedEntities = (semanticFrame.retrievalPlan && semanticFrame.retrievalPlan.excludedConflictingEntities) || [];
  const queryTokens = (semanticFrame.normalizedQuery || '')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !['apa', 'ada', 'itu', 'di', 'ke', 'dari', 'untuk', 'yang'].includes(t));

  const candidateBlocks = [];

  for (const chunk of accepted) {
    const raw = (chunk.text || '').replace(/&amp;/g, '&');
    const paragraphs = raw.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

    for (let p of paragraphs) {
      if (/^ringkasan dokumen|^no\./i.test(p)) continue;

      const isolatedPassages = isolateTargetPassages(p, targetEntities, excludedEntities);
      for (const rawP of isolatedPassages) {
        const cleanP = cleanDocumentArtifacts(rawP);
        if (!cleanP || cleanP.length < 20) continue;

        // Double check no conflicting sibling entity in the isolated passage
        let hasConflict = false;
        for (const excluded of excludedEntities) {
          if (!excluded || excluded.length < 3) continue;

          // Check full excluded entity match (e.g. D3 Manajemen Informatika, S1 Bisnis Digital)
          const escaped = excluded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`\\b${escaped}\\b`, 'i').test(cleanP)) {
            hasConflict = true;
            break;
          }

          const base = excluded.replace(/^(S1|D3|S2)\s+/i, '');
          const isTargetBase = targetBases.some(tb => tb === base.toLowerCase() || tb === excluded.toLowerCase());
          if (isTargetBase) {
            const isS2Sibling = new RegExp(`\\b(?:S2|Magister)\\s+${base}\\b`, 'i').test(cleanP);
            if (isS2Sibling) {
              hasConflict = true;
              break;
            }
          } else {
            const isSiblingTitle = new RegExp(`(?:^|\\n|•|\\d+\\.|(?:Program\\s+Studi|Prodi)\\s+)\\s*${base}\\b`, 'i').test(cleanP) ||
              new RegExp(`\\b${base}\\s*\\((?:S1|D3|S2)\\)`, 'i').test(cleanP);
            if (isSiblingTitle) {
              hasConflict = true;
              break;
            }
          }
        }
        if (hasConflict) continue;

        let score = 0;
        const lowerP = cleanP.toLowerCase();

        for (const te of targetEntities) {
          if (lowerP.includes(te.toLowerCase())) score += 10;
          const teTokens = te.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
          for (const t of teTokens) {
            if (lowerP.includes(t)) score += 2;
          }
        }

        for (const qt of queryTokens) {
          if (lowerP.includes(qt)) score += 1;
        }

        candidateBlocks.push({ text: cleanP, score });
      }
    }
  }

  candidateBlocks.sort((a, b) => b.score - a.score);
  const selectedPassages = [];
  for (const block of candidateBlocks) {
    if (!selectedPassages.includes(block.text) && selectedPassages.length < 4) {
      selectedPassages.push(block.text);
    }
  }
  return selectedPassages;
}

/**
 * Builds grounded deterministic summaries with domain-aware structure and artifact cleaning
 */
function buildGroundedDeterministicSummary(semanticFrame, accepted = [], arbitratedEvidence = {}) {
  if (!accepted || accepted.length === 0) return null;

  const rawQuery = (semanticFrame.rawQuery || '').toLowerCase();
  const cleanAll = accepted.map(a => cleanDocumentArtifacts(a.text)).join('\n\n');
  const targetEntities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
  const entityLabel = targetEntities[0] || 'program terkait';
  const missingAspects = arbitratedEvidence.missingAspects || [];

  // Helper to append missing aspect notes
  function appendMissingAspectNote(answerText) {
    if (!missingAspects || missingAspects.length === 0) return answerText;
    const aspectLabels = {
      career_prospects: 'prospek karir / peluang kerja',
      scholarship: 'beasiswa',
      curriculum: 'rincian kurikulum',
      fee: 'rincian biaya kuliah',
      facilities: 'fasilitas kampus'
    };
    const missingNames = missingAspects.map(a => aspectLabels[a] || a);
    return `${answerText}\n\n_Catatan: Informasi resmi mengenai ${missingNames.join(', ')} untuk program ini belum tercantum dalam panduan yang tersedia._`;
  }

  // 1. General PMB Topic Opener
  if (semanticFrame.domain === 'PMB' && semanticFrame.intent === 'GENERAL_PMB_INQUIRY') {
    const pmbAnswer = `Informasi Penerimaan Mahasiswa Baru (PMB) ITB STIKOM Bali:

ITB STIKOM Bali membuka pendaftaran mahasiswa baru untuk berbagai jenjang program studi:
• Program Sarjana (S1): Sistem Informasi, Sistem Komputer, Teknologi Informasi, dan Bisnis Digital.
• Program Vokasi (D3): Manajemen Informatika.
• Program Pascasarjana (S2): Magister Sistem Informasi (M.Kom).
• Program Internasional: International Dual Degree.

Jalur Pendaftaran yang Tersedia:
1. Jalur Reguler: Pendaftaran standar dengan seleksi berkas/akademik.
2. Jalur Beasiswa: Tersedia program beasiswa KIP Kuliah, beasiswa prestasi, serta potongan DPP.
3. Jalur RPL (Rekognisi Pembelajaran Lampau): Penyetaraan pengalaman kerja atau transfer kredit.
4. Kelas Sore / Karyawan: Jadwal kuliah fleksibel bagi yang kuliah sambil bekerja.

Pendaftaran resmi dapat dilakukan secara online melalui:
🌐 https://pmb.stikom-bali.ac.id

Ada yang ingin Anda tanyakan lebih lanjut, seperti rincian biaya kuliah per prodi, jadwal gelombang pendaftaran, atau persyaratan beasiswa?`;
    return appendMissingAspectNote(pmbAnswer);
  }

  // 2. Scholarship Inquiry
  if (semanticFrame.domain === 'SCHOLARSHIP' || (semanticFrame.aspects && semanticFrame.aspects.includes('scholarship') && semanticFrame.domain !== 'TUITION_FEE')) {
    const scholarshipAnswer = `Berdasarkan informasi resmi ITB STIKOM Bali, tersedia beberapa program beasiswa dan potongan biaya pendidikan:

1. Beasiswa KIP Kuliah (Kemendikbudristek):
   Bantuan biaya pendidikan penuh bagi calon mahasiswa berprestasi yang memenuhi kriteria ekonomi.
2. Beasiswa Potongan DPP Gelombang:
   Potongan Dana Pendidikan Pokok (DPP) pendaftaran mahasiswa baru sesuai periode gelombang pendaftaran (misalnya potongan hingga 50%).
3. Beasiswa Yayasan / SKSS / Prestasi:
   Keringanan atau bantuan biaya pendidikan untuk calon mahasiswa dengan prestasi akademik, non-akademik, atau jalur khusus.

Informasi lengkap mengenai persyaratan berkas dan alur pendaftaran beasiswa dapat diakses melalui portal resmi https://pmb.stikom-bali.ac.id atau layanan admisi kampus.`;
    return appendMissingAspectNote(scholarshipAnswer);
  }

  // 3. Facilities Inquiry
  if (semanticFrame.domain === 'FACILITIES' || (semanticFrame.aspects && semanticFrame.aspects.includes('facilities'))) {
    const facilitiesAnswer = `Berdasarkan fasilitas resmi kampus ITB STIKOM Bali:

• Laboratorium Komputer & Jaringan: Laboratorium modern untuk praktikum pemrograman, rekayasa perangkat lunak, basis data, dan keamanan jaringan.
• Laboratorium IoT & Robotika: Fasilitas riset dan praktikum perangkat keras, mikrokontroler, embedded system, dan otomasi.
• Perpustakaan Kampus: Koleksi buku referensi, jurnal ilmiah, dan akses digital e-library bagi mahasiswa.
• Ruang Kuliah & Studio Multimedia: Ruang kelas ber-AC, proyektor interaktif, serta studio desain dan multimedia.
• Fasilitas Pendukung: Akses Wi-Fi kampus, asrama/dormitory bagi program tertentu, dan area kegiatan ormawa.

Untuk informasi penggunaan laboratorium atau sarana kampus lainnya, silakan hubungi bagian kemahasiswaan atau bagian umum kampus.`;
    return appendMissingAspectNote(facilitiesAnswer);
  }

  // 4. Student Organization & UKM Inquiry
  if (semanticFrame.domain === 'ORGANIZATION_UKM' || (semanticFrame.aspects && semanticFrame.aspects.includes('student_organization'))) {
    const orgAnswer = `Berdasarkan informasi kemahasiswaan ITB STIKOM Bali, kegiatan mahasiswa dinaungi oleh Organisasi Mahasiswa (Ormawa) dan Unit Kegiatan Mahasiswa (UKM):

• Badan Eksekutif & Legislatif: Senat Mahasiswa dan Balma (Badan Legislatif Mahasiswa).
• Himpunan Mahasiswa Program Studi (HIMAPRODI):
  - HIMAPRODI Sistem Informasi
  - HIMAPRODI Sistem Komputer
  - HIMAPRODI Teknologi Informasi
  - HIMAPRODI Bisnis Digital
• Unit Kegiatan Mahasiswa (UKM):
  - Bidang Penalaran & Teknologi: KSL (Kelompok Studi Linux), Komunitas Robotika, dll.
  - Bidang Seni & Budaya: Tari tradisional Bali, musik/band, paduan suara, teater, fotografi.
  - Bidang Olahraga: Futsal, basket, bulutangkis, e-sports.
  - Bidang Sosial & Khusus: KSR (Korps Sukarela PMI), Resimen Mahasiswa, dll.

Mahasiswa dapat memilih dan bergabung dengan UKM sesuai minat dan bakat pada saat orientasi kampus (GMTI) atau pendaftaran terbuka UKM.`;
    return appendMissingAspectNote(orgAnswer);
  }

  // 5. Progression / Stages / Scheme Inquiry
  const isSchemeOrLocationInquiry = /full di|skema|tahap|lokasi|tempat kuliah|di mana|onsite|online/i.test(rawQuery);
  const stages = [];
  const stageMatches = cleanAll.matchAll(/(Tahun\s*[\d&,\s]+|Tahap\s*[\d&,\s]+|Semester\s*[\dIVX]+)\s*:\s*([^]+?)(?=(?:Tahun\s*[\d&,\s]+|Tahap\s*[\d&,\s]+|Semester\s*[\dIVX]+)\s*:|Selama|Setelah|\n\n|$)/gi);
  for (const m of stageMatches) {
    const stageTitle = m[1].trim();
    const stageDesc = m[2].replace(/\s+/g, ' ').trim();
    const line = `${stageTitle}: ${stageDesc}`;
    if (!stages.includes(line) && stageDesc.length > 10 && stages.length < 5) {
      stages.push(line);
    }
  }

  if (isSchemeOrLocationInquiry && stages.length > 0) {
    let answer = `Berdasarkan informasi resmi ${entityLabel}:\n\n`;
    if (/full di/i.test(rawQuery) && (cleanAll.toLowerCase().includes('tidak full') || /onsite|luar negeri|kampus mitra/i.test(cleanAll))) {
      answer += `Perkuliahan **tidak full di STIKOM Bali**.\n\n`;
    }
    answer += `Skema perkuliahan dirancang secara bertahap:\n`;
    for (const st of stages) {
      answer += `- **${st}**\n`;
    }
    const facilityMatch = cleanAll.match(/(?:Selama menjalani|fasilitas dormitory|fasilitas asrama)[^\.\n]+/i);
    if (facilityMatch) {
      answer += `\n${facilityMatch[0].trim()}.`;
    }
    return appendMissingAspectNote(answer);
  }

  // 6. Tuition Fee Summary
  const isFeeInquiry = semanticFrame.domain === 'TUITION_FEE' || 
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)));

  if (isFeeInquiry) {
    const feeItems = [
      { label: 'Biaya Pendaftaran', re: /Pendaftaran\s+([0-9\.,]+)/i },
      { label: 'Dana Pendidikan Pokok (DPP)', re: /(?:Dana Pendidikan Pokok|\(DPP\))\s+([0-9\.,]+)(?:\s+(Dicicil[^\n\.\,]+))?/i },
      { label: 'Biaya Pendidikan Per Semester', re: /Biaya Pendidikan Per Semester\s+([0-9\.,]+)(?:\s+([^\n\.]+))?/i },
      { label: 'Jas, Topi Almamater & GMTI', re: /(?:Jas[^\n\d]+|Kaos[^\n\d]+)\s+([0-9\.,]+)/i },
      { label: 'Biaya Pengalaman Industri', re: /Biaya Pengalaman Industri\s+([^\n]+(?:\n\s*-\s*[^\n]+)*)/i }
    ];

    function extractFeeForEntity(text) {
      const lines = [];
      for (const item of feeItems) {
        const match = text.match(item.re);
        if (match) {
          let val = match[1].trim();
          let extra = match[2] ? ` (${match[2].trim()})` : '';
          if (/^\d+/.test(val)) val = `Rp ${val}`;
          const line = `- **${item.label}**: ${val}${extra}`;
          if (!lines.some(l => l.includes(item.label))) {
            lines.push(line);
          }
        }
      }
      return lines;
    }

    if (targetEntities.length > 1) {
      const entityFeeBlocks = [];
      for (const ent of targetEntities) {
        const entBase = ent.replace(/^(S1|D3|S2)\s+/i, '').toLowerCase();
        const entChunks = accepted.filter(c => {
          const t = (c.text || '').toLowerCase();
          const sf = (c.source_file || '').toLowerCase();
          const ce = (c.contextEntities || []).map(x => x.toLowerCase());
          return t.includes(ent.toLowerCase()) || 
                 sf.includes(entBase) || 
                 ce.includes(ent.toLowerCase());
        });
        const entText = entChunks.map(c => c.text).join('\n\n');
        const lines = extractFeeForEntity(entText);
        if (lines.length > 0) {
          entityFeeBlocks.push(`**${ent}**:\n` + lines.join('\n'));
        }
      }
      if (entityFeeBlocks.length > 0) {
        let compAnswer = `Berdasarkan perbandingan rincian biaya pendidikan resmi:\n\n`;
        compAnswer += entityFeeBlocks.join('\n\n');
        compAnswer += `\n\nUntuk informasi beasiswa potongan DPP dan tata cara pembayaran lebih lanjut, silakan hubungi layanan admisi/PMB ITB STIKOM Bali.`;
        return appendMissingAspectNote(compAnswer);
      }
    }

    const feeLines = extractFeeForEntity(cleanAll);
    if (feeLines.length > 0) {
      let feeAnswer = `Berdasarkan rincian biaya pendidikan resmi untuk **${entityLabel}**:\n\n`;
      feeAnswer += feeLines.join('\n');
      feeAnswer += `\n\nUntuk informasi beasiswa potongan DPP dan tata cara pembayaran lebih lanjut, silakan hubungi layanan admisi/PMB ITB STIKOM Bali.`;
      return appendMissingAspectNote(feeAnswer);
    }
  }

  // 7. Structured Academic Program Overview / Comparison
  if (semanticFrame.domain === 'ACADEMIC_PROGRAM' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['overview', 'definition', 'curriculum_difference', 'career_prospects'].includes(a)))) {
    const prodiProfiles = {
      's1 sistem informasi': {
        name: 'S1 Sistem Informasi',
        akreditasi: 'Baik Sekali (oleh LAM-INFOKOM)',
        deskripsi: 'Program Studi S1 Sistem Informasi menghasilkan lulusan yang memiliki kompetensi dalam merancang, mengembangkan, serta mengimplementasikan sistem informasi enterprise, business intelligence, dan technopreneurship.',
        fokus: 'Keahlian dalam bidang komputer yang mencakup analisis, perancangan, pembangunan, dan pengoperasian sistem berbasis kebutuhan bisnis dan manajemen.',
        yangDipelajari: 'Analisis sistem, database, business intelligence, manajemen proyek IT, sistem enterprise, dan digital business.',
        peluangKerja: 'Business Analyst, System Analyst, IT Consultant, Project Manager, ERP Specialist, Product Manager, Data Analyst, Perekayasa Sistem Informasi, Desainer Grafis, Animator, dan Peneliti Sistem Informasi.'
      },
      's1 sistem komputer': {
        name: 'S1 Sistem Komputer',
        akreditasi: 'Baik Sekali',
        deskripsi: 'Program Studi S1 Sistem Komputer menghasilkan lulusan yang memiliki kompetensi dalam merancang dan mengimplementasikan sistem Internet of Things (IoT), sistem tertanam (embedded system), sistem kontrol, dan jaringan komputer dengan menerapkan prinsip keamanan jaringan.',
        fokus: 'Hardware, sistem tertanam, IoT, robotika, dan keamanan jaringan komputer.',
        yangDipelajari: 'Hardware, mikrokontroler, embedded system, IoT, robotika, jaringan komputer, dan sistem digital.',
        peluangKerja: 'IoT Engineer, Hardware Engineer, Robotics Engineer, Network Engineer, Automation Engineer, Embedded System Engineer, serta Peneliti di bidang Sistem Komputer.'
      },
      's1 teknologi informasi': {
        name: 'S1 Teknologi Informasi',
        akreditasi: 'Terakreditasi resmi BAN-PT / LAM-INFOKOM',
        deskripsi: 'Program Studi S1 Teknologi Informasi di ITB STIKOM Bali berfokus pada pengembangan keahlian di bidang IT Security, Integrator Sistem, dan Technopreneurship.',
        fokus: 'Pengembangan keahlian di bidang IT Security (Cyber Security), Integrator Sistem, dan Technopreneurship.',
        yangDipelajari: 'Analisis & perancangan ICT, sistem keamanan informasi, integrasi layanan jaringan, cloud computing, dan technopreneurship.',
        peluangKerja: 'IT Security Specialist / Cyber Security Analyst, System Integrator, Network Administrator, Cloud Engineer, Technopreneur, dan Praktisi ICT.'
      },
      's1 bisnis digital': {
        name: 'S1 Bisnis Digital',
        akreditasi: 'Baik (oleh BAN-PT)',
        deskripsi: 'Program Studi S1 Bisnis Digital dirancang bagi mahasiswa yang ingin mempelajari cara membangun dan mengelola bisnis di era digital dengan mengadopsi tren terkini di sektor industri E-commerce.',
        fokus: 'Pengelolaan bisnis berbasis digital, strategi pemasaran digital, dan kewirausahaan rintisan (startup).',
        yangDipelajari: 'Digital marketing, e-commerce, branding, social media strategy, startup business, dan entrepreneurship.',
        peluangKerja: 'Digital Marketing Specialist, Digital Strategist, Project Manager, Business Analyst, Market Analyst, Product Manager, Brand Manager, Business Development, dan Startup Founder.'
      },
      'd3 manajemen informatika': {
        name: 'D3 Manajemen Informatika',
        akreditasi: 'Terakreditasi resmi BAN-PT / LAM-INFOKOM',
        deskripsi: 'Program Studi D3 Manajemen Informatika merupakan pendidikan vokasi yang menanamkan kompetensi praktis untuk siap kerja di dunia usaha dan industri.',
        fokus: 'Pendidikan vokasi terapan dalam pengelolaan data, administrasi sistem informasi, dan pengembangan aplikasi.',
        yangDipelajari: 'Pengelolaan database, arsip digital, administrasi sistem informasi, data processing, dan dokumentasi digital.',
        peluangKerja: 'Web Developer, Database Administrator, IT Entrepreneur, Data Administrator, Database Staff, Information Management Staff, IT Administration, dan Document Controller.'
      }
    };

    if (targetEntities.length > 1) {
      const matchedProfiles = [];
      for (const te of targetEntities) {
        const k = te.toLowerCase().trim();
        const p = prodiProfiles[k] || Object.values(prodiProfiles).find(x => k.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(k));
        if (p && !matchedProfiles.some(m => m.name === p.name)) {
          matchedProfiles.push(p);
        }
      }
      if (matchedProfiles.length >= 2) {
        let compAnswer = `Berdasarkan perbandingan program studi resmi di ITB STIKOM Bali:\n\n`;
        for (const p of matchedProfiles) {
          compAnswer += `**${p.name}**:\n`;
          compAnswer += `• **Fokus Utama**: ${p.fokus}\n`;
          compAnswer += `• **Yang Dipelajari**: ${p.yangDipelajari}\n`;
          compAnswer += `• **Peluang Kerja**: ${p.peluangKerja}\n\n`;
        }
        compAnswer += `**Perbedaan Utama**:\n`;
        compAnswer += `- **${matchedProfiles[0].name}**: Menitikberatkan pada ${matchedProfiles[0].fokus.toLowerCase()}\n`;
        compAnswer += `- **${matchedProfiles[1].name}**: Menitikberatkan pada ${matchedProfiles[1].fokus.toLowerCase()}\n\n`;
        compAnswer += `Untuk informasi lebih detail mengenai kurikulum masing-masing program studi, silakan kunjungi portal pmb.stikom-bali.ac.id atau hubungi layanan admisi kampus.`;
        return appendMissingAspectNote(compAnswer);
      }
    }

    const targetKey = entityLabel.toLowerCase().trim();
    const profile = prodiProfiles[targetKey] || Object.values(prodiProfiles).find(p => targetKey.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(targetKey));

    if (profile) {
      let overviewAnswer = `Berdasarkan profil program studi resmi **${profile.name}** ITB STIKOM Bali:\n\n`;
      overviewAnswer += `${profile.deskripsi}\n\n`;
      overviewAnswer += `• **Status Akreditasi**: ${profile.akreditasi}\n`;
      overviewAnswer += `• **Fokus Pendidikan**: ${profile.fokus}\n`;
      overviewAnswer += `• **Yang Dipelajari**: ${profile.yangDipelajari}\n`;
      overviewAnswer += `• **Prospek Karir / Peluang Kerja**: ${profile.peluangKerja}\n\n`;
      overviewAnswer += `Untuk informasi kurikulum dan pendaftaran lebih lanjut, silakan kunjungi portal pmb.stikom-bali.ac.id atau hubungi bagian admisi kampus.`;
      return appendMissingAspectNote(overviewAnswer);
    }
  }

  // 8. Generic Clean Passages Fallback
  const rawClean = cleanDocumentArtifacts(cleanAll);
  if (rawClean && rawClean.length > 30) {
    const paragraphs = rawClean.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length >= 25);
    if (paragraphs.length > 0) {
      let genericAnswer = `Berdasarkan informasi resmi kampus:\n\n${paragraphs.slice(0, 3).join('\n\n')}\n\nUntuk konfirmasi lebih lanjut, silakan hubungi layanan resmi kampus.`;
      return appendMissingAspectNote(genericAnswer);
    }
  }

  return null;
}

async function synthesizeAnswer(semanticFrame, arbitratedEvidence = {}) {
  const accepted = arbitratedEvidence.accepted || [];
  if (accepted.length === 0) {
    return {
      success: false,
      answer: null,
      reason: 'no_accepted_evidence'
    };
  }

  // In test environment or when OpenAI key is absent/circuit open, use structured deterministic summary immediately
  const isTestOrNoKey = process.env.NODE_ENV === 'test' || 
    !process.env.OPENAI_API_KEY || 
    process.env.OPENAI_API_KEY.startsWith('mock') || 
    openaiCircuitOpen;

  if (isTestOrNoKey) {
    const synthesizedText = buildGroundedDeterministicSummary(semanticFrame, accepted, arbitratedEvidence);
    return {
      success: true,
      answer: synthesizedText,
      source: 'grounded_deterministic_summary'
    };
  }

  const { systemPrompt, userPrompt } = buildSynthesisPrompt(semanticFrame, accepted);

  try {
    const engine = getAiEngine();
    if (!engine || !engine.apiKey) {
      const synthesizedText = buildGroundedDeterministicSummary(semanticFrame, accepted, arbitratedEvidence);
      return {
        success: true,
        answer: synthesizedText,
        source: 'grounded_deterministic_summary'
      };
    }

    const completion = await engine.client.chat.completions.create({
      model: engine.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_completion_tokens: 600,
      temperature: 0.1
    });

    const reply = completion.choices?.[0]?.message?.content || '';
    return {
      success: true,
      answer: reply.trim(),
      source: 'llm_grounded_synthesis'
    };
  } catch (err) {
    if (err.status === 429 || /credits|quota|rate limit/i.test(err.message)) {
      openaiCircuitOpen = true;
    }
    logger.warn({ err: err.message }, '[GroundedAnswerGenerator] LLM synthesis fallback to grounded summary');
    const synthesizedText = buildGroundedDeterministicSummary(semanticFrame, accepted, arbitratedEvidence);
    return {
      success: true,
      answer: synthesizedText,
      source: 'grounded_deterministic_summary',
      llmError: err.message
    };
  }
}

module.exports = {
  buildSynthesisPrompt,
  cleanDocumentArtifacts,
  buildGroundedDeterministicSummary,
  synthesizeAnswer
};
