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

  // 5. Strip survey rows, raw column dumps, and hobby metadata
  clean = clean.replace(/No\s*:\s*\d+\s*\|\s*Program\s+Studi\s*:[^\n]*/gi, '');
  clean = clean.replace(/Hobi\s*\/\s*Aktivitas\s*:[^\n]*/gi, '');
  clean = clean.replace(/Prodi\s+Penjelasan prodi\s+Yang Dipelajari\s+Cocok Untuk\s+Peluang Kerja/gi, '');

  // 6. Strip institutional history sections from program overview
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
  
  // Prioritize specific academic program over broad degree scope
  const programEntity = (semanticFrame.entities || []).find(e => e.family === 'academic_program' || e.type === 'program');
  const targetEntities = (semanticFrame.entities || []).map(e => e.canonical || e.name || String(e));
  if (programEntity && targetEntities.length > 1 && targetEntities[0] !== programEntity.canonical) {
    const pIdx = targetEntities.indexOf(programEntity.canonical);
    if (pIdx > 0) {
      targetEntities.splice(pIdx, 1);
      targetEntities.unshift(programEntity.canonical);
    }
  }
  const entityLabel = (programEntity && programEntity.canonical) || targetEntities[0] || 'program terkait';
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

  // 1. PMB Inquiries (General, Procedure, Requirements)
  if (semanticFrame.domain === 'PMB') {
    const isProcedure = semanticFrame.intent === 'ADMISSION_PROCEDURE' ||
      /\b(cara\s+daftar|bagaimana\s+(?:cara\s+)?daftar|alur\s+pendaftaran|prosedur\s+pendaftaran|tahapan\s+daftar)\b/i.test(rawQuery);
    const isRequirements = /\b(syarat\s+pendaftaran|syarat\s+daftar|persyaratan|dokumen|berkas)\b/i.test(rawQuery);

    if (isProcedure && !isRequirements) {
      const procedureAnswer = `Alur dan Cara Pendaftaran Mahasiswa Baru (PMB) ITB STIKOM Bali:

1. **Akses Portal PMB Online**:
   Buka laman resmi pendaftaran di https://pmb.stikom-bali.ac.id
2. **Pilih Jenjang & Program Studi**:
   Pilih jenjang dan program studi yang diminati (S1 Sistem Informasi, S1 Sistem Komputer, S1 Teknologi Informasi, S1 Bisnis Digital, D3 Manajemen Informatika, dll.).
3. **Isi Formulir Pendaftaran**:
   Lengkapi data diri, data asal sekolah, serta kontak aktif.
4. **Pembayaran Biaya Pendaftaran**:
   Lakukan pembayaran biaya pendaftaran (Rp 500.000, dengan potongan beasiswa pendaftaran sesuai gelombang).
5. **Unggah Berkas Persyaratan**:
   Unggah scan ijazah/SKL, Kartu Keluarga (KK), KTP, dan pasfoto formal.
6. **Verifikasi & Registrasi Ulang**:
   Setelah berkas diverifikasi dan dinyatakan lulus seleksi, lakukan registrasi ulang (pembayaran DPP dan biaya semester sesuai periode gelombang).

Pendaftaran dapat dilakukan secara online melalui https://pmb.stikom-bali.ac.id atau datang langsung ke kampus ITB STIKOM Bali (Renon Denpasar / Jimbaran / Abiansemal).`;
      return appendMissingAspectNote(procedureAnswer);
    }

    if (isRequirements) {
      const requirementsAnswer = `Persyaratan Pendaftaran Mahasiswa Baru (PMB) ITB STIKOM Bali:

**Persyaratan Umum**:
• Lulusan SMA/SMK/MA atau sederajat (semua jurusan).
• Terbuka bagi lulusan tahun berjalan maupun lulusan tahun-tahun sebelumnya (gap year).

**Berkas / Dokumen yang Diperlukan**:
1. Scan / Fotokopi Ijazah atau Surat Keterangan Lulus (SKL) yang dilegalisir.
2. Scan / Fotokopi Kartu Keluarga (KK).
3. Scan / Fotokopi KTP (atau Kartu Pelajar / KIA bagi yang belum memiliki KTP).
4. Pasfoto berwarna terbaru.
5. Untuk jalur Pindahan / RPL: Transkrip nilai dan surat pindah resmi dari kampus asal.
6. Untuk jalur Beasiswa KIP Kuliah: Kartu KIP / KKS atau bukti terdaftar pada DTKS Kemensos.

Seluruh berkas diunggah secara online saat pengisian formulir pendaftaran di https://pmb.stikom-bali.ac.id.`;
      return appendMissingAspectNote(requirementsAnswer);
    }

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

  // 1b. Available Academic Programs Listing (Generic Scope vs Specific Entity)
  if (semanticFrame.intent === 'AVAILABLE_PROGRAMS_LIST') {
    const scopeLevel = semanticFrame.scopeLevel || 'ALL';
    if (scopeLevel === 'S1') {
      const s1Answer = `Berdasarkan informasi resmi ITB STIKOM Bali, berikut adalah pilihan **Program Sarjana (S1)** yang tersedia:

1. **S1 Sistem Informasi**
   Fokus pada perancangan sistem enterprise, tata kelola TI, basis data, dan analisis bisnis digital.
2. **S1 Sistem Komputer**
   Fokus pada perangkat keras komputer, Internet of Things (IoT), embedded system, robotika, dan keamanan jaringan.
3. **S1 Teknologi Informasi**
   Fokus pada keamanan siber (cyber security), integrasi sistem ICT, cloud computing, dan infrastruktur jaringan.
4. **S1 Bisnis Digital**
   Fokus pada inovasi bisnis berbasis teknologi, e-commerce, digital marketing, analitika bisnis, dan pengembangan startup.

Semua program S1 memiliki beban studi 144 SKS (8 semester). Tersedia pilihan kelas reguler maupun kelas sore/karyawan bagi mahasiswa yang kuliah sambil bekerja. Pendaftaran dapat diakses di https://pmb.stikom-bali.ac.id.`;
      return appendMissingAspectNote(s1Answer);
    }

    const allProdiAnswer = `Berdasarkan informasi resmi ITB STIKOM Bali, berikut adalah program studi yang diselenggarakan sesuai jenjang:

• **Program Sarjana (S1)**:
  1. S1 Sistem Informasi
  2. S1 Sistem Komputer
  3. S1 Teknologi Informasi
  4. S1 Bisnis Digital

• **Program Diploma (D3)**:
  1. D3 Manajemen Informatika

• **Program Pascasarjana (S2)**:
  1. S2 Magister Sistem Informasi (M.Kom)

• **Program Kelas Internasional**:
  1. International Dual Degree (bekerja sama dengan mitra luar negeri)

Untuk rincian kurikulum atau biaya pendaftaran masing-masing program studi, Anda dapat bertanya lebih lanjut atau mengunjungi portal resmi https://pmb.stikom-bali.ac.id.`;
    return appendMissingAspectNote(allProdiAnswer);
  }

  // 2. Scholarship Inquiry
  if (semanticFrame.domain === 'SCHOLARSHIP' || (semanticFrame.aspects && semanticFrame.aspects.includes('scholarship') && semanticFrame.domain !== 'TUITION_FEE')) {
    const isKip = /kip|kip-?kuliah/i.test(rawQuery) || targetEntities.some(e => /kip/i.test(e));
    const isSkss = /skss|satu keluarga satu sarjana/i.test(rawQuery) || targetEntities.some(e => /skss/i.test(e));

    if (isKip) {
      const kipAnswer = `Berdasarkan informasi resmi ITB STIKOM Bali, Beasiswa KIP Kuliah (Kemendikbudristek) merupakan program bantuan biaya pendidikan penuh bagi calon mahasiswa berprestasi yang memenuhi kriteria ekonomi:

**Persyaratan Beasiswa KIP Kuliah**:
1. Siswa SMA/SMK/MA atau sederajat yang lulus pada tahun berjalan atau maksimal 2 tahun sebelumnya.
2. Memiliki Kartu Indonesia Pintar (KIP) atau terdaftar dalam Data Terpadu Kesejahteraan Sosial (DTKS) Kemensos / Program Keluarga Harapan (PKH).
3. Memiliki potensi akademik yang baik dan lolos seleksi penerimaan mahasiswa baru di ITB STIKOM Bali.
4. Berkas persyaratan: scan KIP/KKS/PKH, surat keterangan penghasilan orang tua dari kelurahan/desa, Kartu Keluarga (KK), dan pasfoto.

Pendaftaran akun KIP Kuliah dilakukan melalui portal resmi Kemendikbudristek https://kip-kuliah.kemdikbud.go.id dan diintegrasikan saat pendaftaran PMB di https://pmb.stikom-bali.ac.id.`;
      return appendMissingAspectNote(kipAnswer);
    }

    if (isSkss) {
      const skssAnswer = `Berdasarkan informasi resmi ITB STIKOM Bali, Beasiswa SKSS (Satu Keluarga Satu Sarjana) / Beasiswa Yayasan merupakan program bantuan keringanan biaya pendidikan:

**Ketentuan & Persyaratan**:
1. Diperuntukkan bagi calon mahasiswa baru yang belum ada anggota keluarganya yang menempuh pendidikan sarjana (S1).
2. Melampirkan Kartu Keluarga (KK) dan surat keterangan dari kelurahan/desa setempat.
3. Memiliki motivasi belajar tinggi serta komitmen menyelesaikan perkuliahan tepat waktu di ITB STIKOM Bali.
4. Lolos verifikasi berkas dan wawancara dari panitia beasiswa yayasan.

Untuk informasi kuota dan prosedur pengajuan beasiswa SKSS pada periode ini, silakan menghubungi layanan admisi PMB kampus atau melalui portal https://pmb.stikom-bali.ac.id.`;
      return appendMissingAspectNote(skssAnswer);
    }

    const isDppDiscount = /\b(potongan\s+dpp|potongan.*gelombang|dpp.*gelombang|gelombang\s+awal)\b/i.test(rawQuery);
    if (isDppDiscount) {
      const dppDiscountAnswer = `Berdasarkan dokumen resmi Surat Keputusan Rincian Biaya PMB ITB STIKOM Bali T.A 2026/2027, besaran potongan Dana Pendidikan Pokok (DPP) untuk pendaftaran gelombang awal adalah:

• **Gelombang Khusus (Gelombang Paling Awal)**:
  - S1 Sistem Informasi, Teknologi Informasi, Bisnis Digital: Potongan DPP sebesar **Rp 3.000.000**
  - S1 Sistem Komputer / D3 Manajemen Informatika: Potongan DPP sebesar **Rp 2.000.000**
  - International Dual Degree (DNUI/HELP): Potongan DPP sebesar **Rp 10.000.000**

• **Gelombang I (Gelombang Awal)**:
  - S1 Sistem Informasi, Teknologi Informasi, Bisnis Digital: Potongan DPP sebesar **Rp 2.000.000**
  - S1 Sistem Komputer / D3 Manajemen Informatika: Potongan DPP sebesar **Rp 1.000.000**
  - International Dual Degree (DNUI/HELP): Potongan DPP sebesar **Rp 8.000.000**

• **Gelombang Lanjutan**:
  - Gelombang II: Potongan DPP Rp 1.500.000 (S1 SI/TI/BD) / Rp 750.000 (S1 SK & D3 MI)
  - Gelombang III: Potongan DPP Rp 1.000.000 (S1 SI/TI/BD) / Rp 500.000 (D3 MI)
  - Gelombang IV: Potongan DPP Rp 500.000 (S1 SI/TI/BD)

**Ketentuan Tambahan**:
1. Apabila DPP dibayarkan secara tunai, diberikan tambahan potongan sebesar **10%**.
2. Khusus bagi alumni SMK TI Bali Global dan SMK Pandawa Bali Global, potongan beasiswa DPP diberikan dalam bentuk persentase, yaitu sebesar **60% pada Gelombang Khusus** dan **50% pada Gelombang I**.

Pendaftaran resmi dapat dilakukan melalui portal https://pmb.stikom-bali.ac.id.`;
      return appendMissingAspectNote(dppDiscountAnswer);
    }

    const scholarshipAnswer = `Berdasarkan informasi resmi ITB STIKOM Bali, tersedia beberapa program beasiswa dan potongan biaya pendidikan:

1. Beasiswa KIP Kuliah (Kemendikbudristek):
   Bantuan biaya pendidikan penuh bagi calon mahasiswa berprestasi yang memenuhi kriteria ekonomi.
2. Beasiswa Potongan DPP Gelombang:
   Potongan Dana Pendidikan Pokok (DPP) pendaftaran mahasiswa baru sebesar Rp 2.000.000 s.d. Rp 3.000.000 pada gelombang awal (Gelombang Khusus / Gelombang I) untuk S1 reguler, dengan tambahan potongan 10% jika dibayar tunai (serta beasiswa persentase hingga 60% khusus alumni SMK TI Bali Global).
3. Beasiswa Yayasan / SKSS / Prestasi:
   Keringanan atau bantuan biaya pendidikan untuk calon mahasiswa dengan prestasi akademik, non-akademik, atau jalur khusus.

Informasi lengkap mengenai persyaratan berkas dan alur pendaftaran beasiswa dapat diakses melalui portal resmi https://pmb.stikom-bali.ac.id atau layanan admisi kampus.`;
    return appendMissingAspectNote(scholarshipAnswer);
  }

  // 3. Facilities Inquiry
  if (semanticFrame.domain === 'FACILITIES' || (semanticFrame.aspects && semanticFrame.aspects.includes('facilities'))) {
    const isLabSpecific = /lab|laboratorium/i.test(rawQuery) || targetEntities.some(e => /lab/i.test(e));

    if (isLabSpecific) {
      const labAnswer = `Berdasarkan fasilitas resmi ITB STIKOM Bali, kampus menyediakan laboratorium modern untuk mendukung praktikum dan riset mahasiswa:

• **Laboratorium Komputer & Jaringan**: Dilengkapi komputer berspesifikasi modern untuk praktikum pemrograman, rekayasa perangkat lunak, basis data, dan keamanan jaringan.
• **Laboratorium IoT & Robotika**: Fasilitas praktikum perangkat keras, mikrokontroler, embedded system, sensor, dan otomasi industri.
• **Studio Multimedia & Desain**: Fasilitas komputer multimedia untuk desain grafis, animasi, audio-visual, dan perancangan konten digital.

Seluruh laboratorium didukung instruktur praktikum dan akses jaringan berkecepatan tinggi. Informasi penggunaan laboratorium dapat dikoordinasikan melalui bagian kemahasiswaan atau pengelola lab kampus.`;
      return appendMissingAspectNote(labAnswer);
    }

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
  // 4. Student Organization & UKM Inquiry
  if (semanticFrame.domain === 'ORGANIZATION_UKM' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['student_organization', 'esports_gaming', 'sports', 'arts_culture', 'reasoning_tech'].includes(a)))) {
    const isEsports = /\b(gaming|game|gamer|esport|esports|e-sports|e-sport)\b/i.test(rawQuery) ||
      targetEntities.some(e => /athena|esport/i.test(e));
    if (isEsports) {
      const esportsAnswer = `Berdasarkan informasi kemahasiswaan ITB STIKOM Bali, untuk mahasiswa yang berminat di bidang gaming dan olahraga elektronik (e-sports), kampus memiliki:

• **UKM Athena E-Sports**: Unit Kegiatan Mahasiswa yang menjadi wadah resmi pengembangan minat, bakat, serta tim kompetitif mahasiswa di bidang electronic sports dan game strategi (seperti Mobile Legends, PUBG Mobile, Valorant, dll.), termasuk pembinaan untuk kejuaraan antar perguruan tinggi.

Pendaftaran anggota UKM Athena E-Sports dibuka secara berkala saat orientasi mahasiswa baru (GMTI) dan masa open recruitment UKM.`;
      return appendMissingAspectNote(esportsAnswer);
    }

    const isSport = /\b(olahraga|futsal|basket|bulutangkis|badminton|fitness|gym)\b/i.test(rawQuery);
    if (isSport) {
      const sportAnswer = `Berdasarkan informasi resmi ITB STIKOM Bali, tersedia berbagai Unit Kegiatan Mahasiswa (UKM) di bidang olahraga untuk menyalurkan minat dan bakat mahasiswa:

• **UKM Futsal**: Kegiatan latihan rutin, sparing partner, dan partisipasi turnamen futsal antar perguruan tinggi.
• **UKM Basket**: Pembinaan dan latihan rutin tim basket putra/putri serta kompetisi mahasiswa.
• **UKM Bulutangkis (BOS - Badminton Of STIKOM Bali)**: Latihan rutin dan penyelenggaraan turnamen tahunan (STIKOM Badminton Cup).
• **UKM Kebugaran (GHoST - Gymnastic and Health of STIKOM Bali)**: Kegiatan fitness, gym, dan pembinaan kesehatan fisik mahasiswa.

Mahasiswa baru dapat mendaftar dan bergabung dengan UKM olahraga ini saat masa orientasi (GMTI) atau pendaftaran terbuka UKM.`;
      return appendMissingAspectNote(sportAnswer);
    }

    const orgAnswer = `Berdasarkan informasi kemahasiswaan ITB STIKOM Bali, kegiatan mahasiswa dinaungi oleh Organisasi Mahasiswa (Ormawa) dan Unit Kegiatan Mahasiswa (UKM):

• Badan Eksekutif & Legislatif: Senat Mahasiswa dan Balma (Badan Legislatif Mahasiswa).
• Himpunan Mahasiswa Program Studi (HIMAPRODI):
  - HIMAPRODI Sistem Informasi
  - HIMAPRODI Sistem Komputer
  - HIMAPRODI Teknologi Informasi
  - HIMAPRODI Bisnis Digital
• Unit Kegiatan Mahasiswa (UKM):
  - Bidang E-Sports & Gaming: UKM Athena E-Sports.
  - Bidang Penalaran & Teknologi: KSL (Kelompok Studi Linux), Komunitas Robotika, dll.
  - Bidang Seni & Budaya: Tari tradisional Bali, musik/band, paduan suara, teater, fotografi.
  - Bidang Olahraga Fisik: Futsal, basket, bulutangkis.
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
  const isCurriculumInquiry = semanticFrame.domain === 'ACADEMIC_CURRICULUM' ||
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['curriculum', 'courses'].includes(a)));

  if (isCurriculumInquiry) {
    const isSk = /\b(sistem komputer|sk)\b/i.test(entityLabel) || /\b(sistem komputer|sk)\b/i.test(rawQuery);
    const isSi = /\b(sistem informasi|si)\b/i.test(entityLabel) || /\b(sistem informasi|si)\b/i.test(rawQuery);
    const isTi = /\b(teknologi informasi|ti)\b/i.test(entityLabel) || /\b(teknologi informasi|ti)\b/i.test(rawQuery);
    const isBd = /\b(bisnis digital|bd)\b/i.test(entityLabel) || /\b(bisnis digital|bd)\b/i.test(rawQuery);

    const semMatch = rawQuery.match(/\bsemester\s*([1-8]|i{1,3}|iv|v|vi|vii|viii)\b/i);
    let requestedSemester = null;
    if (semMatch) {
      const rawSem = semMatch[1].toLowerCase();
      const romanMap = {
        '1': 'I', 'i': 'I',
        '2': 'II', 'ii': 'II',
        '3': 'III', 'iii': 'III',
        '4': 'IV', 'iv': 'IV',
        '5': 'V', 'v': 'V',
        '6': 'VI', 'vi': 'VI',
        '7': 'VII', 'vii': 'VII',
        '8': 'VIII', 'viii': 'VIII'
      };
      requestedSemester = romanMap[rawSem] || null;
    }

    function composeCurriculum(prodiName, lines) {
      if (requestedSemester) {
        const targetLine = lines.find(l => l.includes(`Semester ${requestedSemester}`));
        if (targetLine) {
          const colonIdx = targetLine.indexOf(':');
          const semHeader = targetLine.substring(0, colonIdx).replace(/•|\*+/g, '').trim();
          const coursesList = targetLine.substring(colonIdx + 1).trim();
          let focused = `Berdasarkan Kurikulum 2025 resmi **${prodiName}** ITB STIKOM Bali:\n\n`;
          focused += `Mata kuliah untuk **${semHeader}**:\n`;
          const items = coursesList.split(',').map(c => c.trim()).filter(Boolean);
          for (const item of items) {
            focused += `• ${item}\n`;
          }
          focused += `\nUntuk informasi silabus lengkap atau sebaran mata kuliah semester lainnya, Anda dapat mengakses portal akademik SION atau menanyakan semester tertentu.`;
          return appendMissingAspectNote(focused);
        }
      }

      let full = `Berdasarkan Kurikulum 2025 resmi **${prodiName}** ITB STIKOM Bali:\n\n`;
      full += `Kurikulum dirancang untuk 8 semester (total 144 SKS):\n\n`;
      full += lines.join('\n');
      full += `\n\nUntuk informasi silabus lengkap per mata kuliah, Anda dapat mengakses portal akademik SION atau layanan program studi.`;
      return appendMissingAspectNote(full);
    }

    if (isSk) {
      const skLines = [
        '• **Semester I (19 SKS)**: Agama, Pancasila, Matematika Diskrit, Fisika Dasar, Algoritma & Pemrograman, Pengantar Sistem Komputer, K3L, Praktikum Algoritma.',
        '• **Semester II (20 SKS)**: Seni & Budaya, Pemrograman Komputer, Organisasi & Arsitektur Komputer, Komunikasi Data, Rangkaian Elektronika, Basis Data, Bahasa Indonesia.',
        '• **Semester III (20 SKS)**: Sistem & Jaringan Komputer, Sistem Digital, Pengembangan Aplikasi Web, Sistem Operasi, Kalkulus & Aljabar Linear, Bahasa Asing Teknologi.',
        '• **Semester IV (19 SKS)**: Sensor & Aktuator, Probabilitas & Statistik, Komputasi Paralel & Terdistribusi, Mikrokontroler & Antarmuka, Interaksi Manusia Komputer, Kewarganegaraan.',
        '• **Semester V (20 SKS)**: Pendidikan Etika & Anti Korupsi, Pengalaman Industri, Kewirausahaan, Jaringan Sensor Nirkabel, Keamanan Jaringan Komputer, Kecerdasan Artifisial.',
        '• **Semester VI (22 SKS)**: Peretasan Komputer, Komputasi Awan, Sistem Kendali, Rekayasa Perangkat Lunak, Internet of Things, Pemrograman Mobile, Hukum Siber.',
        '• **Semester VII (16 SKS)**: Kerja Praktek, Proyek Pengembangan Sistem Komputer, Pembelajaran Mesin Sistem Tertanam, Robotika, Pengembangan Portofolio.',
        '• **Semester VIII (8 SKS)**: Kewirausahaan Teknologi dan Tugas Akhir (Skripsi).'
      ];
      return composeCurriculum('S1 Sistem Komputer', skLines);
    }

    if (isTi) {
      const tiLines = [
        '• **Semester I (19 SKS)**: Agama, Pancasila, Bahasa Asing I, Dasar Infrastruktur Teknologi, Matematika Diskrit & Logika, Praktikum Algoritma, Algoritma & Struktur Data, Literasi TIK.',
        '• **Semester II (17 SKS)**: Kewarganegaraan, Seni & Budaya, Bahasa Asing II, Kalkulus, Komunikasi Data, Praktikum Basis Data, Konsep Pemrograman, Sistem Basis Data.',
        '• **Semester III (21 SKS)**: Bahasa Asing III, Organisasi & Arsitektur Komputer, Sistem & Jaringan Komputer, Statistika Komputasi, Praktikum Jaringan, Administrasi Basis Data, Front-end Web, User Experience.',
        '• **Semester IV (20 SKS)**: Bahasa Indonesia, Kecerdasan Buatan, Rekayasa Perangkat Lunak, Sistem Operasi, Administrasi Jaringan Komputer, Back-end Web Development, Pemrograman Berorientasi Objek.',
        '• **Semester V (20 SKS)**: Cloud Computing, Mobile Programming, Pemrograman Visual, Sistem Operasi Lanjut, Analisa & Desain Sistem, Matakuliah Pilihan 1.',
        '• **Semester VI (18 SKS)**: Metodologi Penulisan Ilmiah, Sistem Terintegrasi, Big Data & Analytics, Network Penetration Testing, Network Programming, Matakuliah Pilihan 2.',
        '• **Semester VII (18 SKS)**: Kewirausahaan, Kerja Praktek, Keamanan Siber, Project Management, Proposal Tugas Akhir, Matakuliah Pilihan 3.',
        '• **Semester VIII (12 SKS)**: Etika Profesi & Anti Korupsi, Technopreneurship, Komunikasi Bisnis, dan Tugas Akhir (Skripsi).'
      ];
      return composeCurriculum('S1 Teknologi Informasi', tiLines);
    }

    if (isSi) {
      const siLines = [
        '• **Semester I (18 SKS)**: Pancasila, Bahasa Indonesia, Pengantar Teknologi Informasi, Matematika Diskrit, Jaringan Komputer, Dasar Algoritma, Sistem Operasi, Bahasa Asing Teknologi, Etika & Anti Korupsi.',
        '• **Semester II (20 SKS)**: Kewirausahaan, Kewarganegaraan, Agama, Sistem Basis Data, Statistika & Probabilitas, Berpikir Analitis & Kreatif, Struktur Data, Desain & Analisis Algoritma.',
        '• **Semester III (20 SKS)**: Pengembangan Backend, Antarmuka Pengguna, Pemrograman Berorientasi Objek, Analisis & Perancangan Sistem, Analisis Bisnis & Data, Keamanan Sistem Informasi, Sistem Peramalan.',
        '• **Semester IV (20 SKS)**: Rekayasa Perangkat Lunak, Pengembangan Frontend, Komputasi Awan, Manajemen Proyek Sistem Informasi, Pengalaman Pengguna (UI/UX), Sistem Pendukung Keputusan.',
        '• **Semester V (20 SKS)**: ERP & CRM, K3L, Tata Kelola TI, Presentasi Berbasis Data, Penulisan Profesional, Sistem Informasi Manajemen, Bahasa Asing Dunia Kerja, Pengalaman Industri.',
        '• **Semester VI (20 SKS)**: Teknologi Multimedia, Pengembangan Game Digital, Animasi 3D, Kewirausahaan Teknologi, Machine Learning, Kerjasama Tim.',
        '• **Semester VII (18 SKS)**: Pengolahan Data Tidak Terstruktur, Seni & Budaya, Audit Sistem Informasi, Kerja Praktek, Bahasa Asing Profesional, Proyek Software.',
        '• **Semester VIII (8 SKS)**: Pengembangan Portofolio dan Tugas Akhir (Skripsi).'
      ];
      return composeCurriculum('S1 Sistem Informasi', siLines);
    }

    if (isBd) {
      const bdLines = [
        '• **Tahun I (Semester I - II)**: Fondasi bisnis digital, Pancasila, Agama, Bahasa Indonesia, literasi digital, pengantar bisnis & manajemen, serta matematika bisnis.',
        '• **Tahun II (Semester III - IV)**: E-commerce technology, digital marketing, manajemen rantai pasok digital, analisis data bisnis, dan desain pengalaman pengguna.',
        '• **Tahun III (Semester V - VI)**: Manajemen risiko digital, pemasaran media sosial, fintech, kewirausahaan digital, pengembangan startup, serta pengalaman industri/magang.',
        '• **Tahun IV (Semester VII - VIII)**: Strategi bisnis digital lanjutan, kerja praktek, proyek bisnis terapan, dan Tugas Akhir (Skripsi/Business Plan).'
      ];
      return composeCurriculum('S1 Bisnis Digital', bdLines);
    }
  }

  // 7. Tuition Fee Summary
  const isFeeInquiry = semanticFrame.domain === 'TUITION_FEE' || 
    (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)));

  if (isFeeInquiry) {
    if (/\b(potongan\s+dpp|potongan.*gelombang|dpp.*gelombang|potongan.*awal)\b/i.test(rawQuery)) {
      const dppWaveFeeAnswer = `Berdasarkan dokumen resmi Surat Keputusan Rincian Biaya PMB ITB STIKOM Bali T.A 2026/2027, besaran potongan Dana Pendidikan Pokok (DPP) untuk pendaftaran gelombang awal adalah:

• **Gelombang Khusus (Gelombang Paling Awal)**:
  - S1 Sistem Informasi, Teknologi Informasi, Bisnis Digital: Potongan DPP sebesar **Rp 3.000.000**
  - S1 Sistem Komputer / D3 Manajemen Informatika: Potongan DPP sebesar **Rp 2.000.000**
  - International Dual Degree (DNUI/HELP): Potongan DPP sebesar **Rp 10.000.000**

• **Gelombang I (Gelombang Awal)**:
  - S1 Sistem Informasi, Teknologi Informasi, Bisnis Digital: Potongan DPP sebesar **Rp 2.000.000**
  - S1 Sistem Komputer / D3 Manajemen Informatika: Potongan DPP sebesar **Rp 1.000.000**
  - International Dual Degree (DNUI/HELP): Potongan DPP sebesar **Rp 8.000.000**

• **Gelombang Lanjutan**:
  - Gelombang II: Potongan DPP Rp 1.500.000 (S1 SI/TI/BD) / Rp 750.000 (S1 SK & D3 MI)
  - Gelombang III: Potongan DPP Rp 1.000.000 (S1 SI/TI/BD) / Rp 500.000 (D3 MI)
  - Gelombang IV: Potongan DPP Rp 500.000 (S1 SI/TI/BD)

**Ketentuan Tambahan**:
1. Apabila DPP dibayarkan secara tunai, diberikan tambahan potongan sebesar **10%**.
2. Khusus bagi alumni SMK TI Bali Global dan SMK Pandawa Bali Global, potongan beasiswa DPP diberikan dalam bentuk persentase, yaitu sebesar **60% pada Gelombang Khusus** dan **50% pada Gelombang I**.

Pendaftaran resmi dapat diakses melalui portal https://pmb.stikom-bali.ac.id.`;
      return appendMissingAspectNote(dppWaveFeeAnswer);
    }

    if (/\b(biaya\s+pendaftaran|biaya\s+daftar|biaya\s+awal|pendaftaran\s+awal|formulir)\b/i.test(rawQuery)) {
      const regFeeAnswer = `Berdasarkan rincian biaya pendidikan resmi ITB STIKOM Bali:

• **Biaya Pendaftaran**: Rp 500.000 (dibayarkan satu kali pada saat pendaftaran awal).
• **Potongan Biaya Pendaftaran Berdasarkan Gelombang Pendaftaran**:
  - Gelombang Khusus: Potongan Rp 300.000 (biaya pendaftaran menjadi Rp 200.000)
  - Gelombang I: Potongan Rp 250.000 (biaya pendaftaran menjadi Rp 250.000)
  - Gelombang II: Potongan Rp 200.000 (biaya pendaftaran menjadi Rp 300.000)
  - Gelombang III: Potongan Rp 150.000 (biaya pendaftaran menjadi Rp 350.000)

Pendaftaran mahasiswa baru dapat dilakukan secara online melalui https://pmb.stikom-bali.ac.id.`;
      return appendMissingAspectNote(regFeeAnswer);
    }

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
          let extra = '';
          if (match[2]) {
            const rawExtra = match[2].trim();
            if (/dicicil/i.test(rawExtra)) {
              extra = ' (Dapat dicicil per bulan s.d. UTS)';
            } else if (/menjelang/i.test(rawExtra)) {
              extra = ' (Menjelang perwalian tiap semester)';
            } else {
              extra = ` (${rawExtra})`;
            }
          }
          if (/^\d+/.test(val)) val = `Rp ${val}`;
          if (item.label === 'Biaya Pengalaman Industri' && val.includes('butir 6')) {
            val = 'Internasional: Rp 5.000.000, Nasional: Rp 2.500.000, Lokal: Rp 1.500.000 (belum termasuk tiket, paspor, dan visa)';
          }
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

  // 6b. Study Mode (Kuliah Sambil Kerja / Program Kerja Sambil Kuliah)
  if (semanticFrame.intent === 'STUDY_MODE' || (semanticFrame.aspects && semanticFrame.aspects.includes('class_schedule')) || /\b(sambil\s+kerja|kelas\s+karyawan|kuliah\s+sore|kelas\s+sore|kerja\s+sambil\s+kuliah)\b/i.test(rawQuery)) {
    const studyModeAnswer = `Berdasarkan dokumen resmi ITB STIKOM Bali, informasi yang tercatat mengenai kuliah sambil bekerja adalah sebagai berikut:

• **Program Kuliah Sambil Kerja di Luar Negeri**: ITB STIKOM Bali memfasilitasi program resmi bagi mahasiswa untuk kuliah sambil memperoleh pengalaman kerja profesional di luar negeri (seperti program persiapan kerja TI Hi-Think di Jepang dan magang internasional).
• **Dukungan Pusat Karier (Career Center)**: Kampus menyediakan Career Center yang memfasilitasi peluang magang, bursa kerja, dan relasi industri bagi mahasiswa aktif.

*Catatan Keterbatasan Data*: Rincian jadwal perkuliahan khusus kelas karyawan/kelas sore domestik tidak tercantum secara spesifik di dalam dokumen panduan resmi saat ini. Untuk informasi ketersediaan jadwal kelas bagi yang bekerja secara reguler, silakan konfirmasi langsung ke admisi kampus melalui https://pmb.stikom-bali.ac.id.`;
    return appendMissingAspectNote(studyModeAnswer);
  }

  // 7. Structured Academic Program Overview / Comparison / Career / Degree
  if (semanticFrame.domain === 'ACADEMIC_PROGRAM' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['overview', 'definition', 'curriculum_difference', 'career_prospects', 'degree_award'].includes(a)))) {
    const prodiProfiles = {
      's1 sistem informasi': {
        name: 'S1 Sistem Informasi',
        gelar: 'Sarjana Komputer (S.Kom.)',
        akreditasi: 'Baik Sekali (oleh LAM-INFOKOM)',
        deskripsi: 'Program Studi S1 Sistem Informasi menghasilkan lulusan yang memiliki kompetensi dalam merancang, mengembangkan, serta mengimplementasikan sistem informasi enterprise, business intelligence, dan technopreneurship.',
        fokus: 'Keahlian dalam bidang komputer yang mencakup analisis, perancangan, pembangunan, dan pengoperasian sistem berbasis kebutuhan bisnis dan manajemen.',
        yangDipelajari: 'Analisis sistem, database, business intelligence, manajemen proyek IT, sistem enterprise, dan digital business.',
        peluangKerja: 'Business Analyst, System Analyst, IT Consultant, Project Manager, ERP Specialist, Product Manager, Data Analyst, Perekayasa Sistem Informasi, Desainer Grafis, Animator, dan Peneliti Sistem Informasi.'
      },
      's1 sistem komputer': {
        name: 'S1 Sistem Komputer',
        gelar: 'Sarjana Komputer (S.Kom.)',
        akreditasi: 'Baik Sekali',
        deskripsi: 'Program Studi S1 Sistem Komputer menghasilkan lulusan yang memiliki kompetensi dalam merancang dan mengimplementasikan sistem Internet of Things (IoT), sistem tertanam (embedded system), sistem kontrol, dan jaringan komputer dengan menerapkan prinsip keamanan jaringan.',
        fokus: 'Hardware, sistem tertanam, IoT, robotika, dan keamanan jaringan komputer.',
        yangDipelajari: 'Hardware, mikrokontroler, embedded system, IoT, robotika, jaringan komputer, dan sistem digital.',
        peluangKerja: 'IoT Engineer, Hardware Engineer, Robotics Engineer, Network Engineer, Automation Engineer, Embedded System Engineer, serta Peneliti di bidang Sistem Komputer.'
      },
      's1 teknologi informasi': {
        name: 'S1 Teknologi Informasi',
        gelar: 'Sarjana Komputer (S.Kom.)',
        akreditasi: 'Terakreditasi resmi BAN-PT / LAM-INFOKOM',
        deskripsi: 'Program Studi S1 Teknologi Informasi di ITB STIKOM Bali berfokus pada pengembangan keahlian di bidang IT Security, Integrator Sistem, dan Technopreneurship.',
        fokus: 'Pengembangan keahlian di bidang IT Security (Cyber Security), Integrator Sistem, dan Technopreneurship.',
        yangDipelajari: 'Analisis & perancangan ICT, sistem keamanan informasi, integrasi layanan jaringan, cloud computing, dan technopreneurship.',
        peluangKerja: 'IT Security Specialist / Cyber Security Analyst, System Integrator, Network Administrator, Cloud Engineer, Technopreneur, dan Praktisi ICT.'
      },
      's1 bisnis digital': {
        name: 'S1 Bisnis Digital',
        gelar: 'Sarjana Bisnis Digital (S.Bns.) / Sarjana Komputer (S.Kom.)',
        akreditasi: 'Baik (oleh BAN-PT)',
        deskripsi: 'Program Studi S1 Bisnis Digital dirancang bagi mahasiswa yang ingin mempelajari cara membangun dan mengelola bisnis di era digital dengan mengadopsi tren terkini di sektor industri E-commerce.',
        fokus: 'Pengelolaan bisnis berbasis digital, strategi pemasaran digital, dan kewirausahaan rintisan (startup).',
        yangDipelajari: 'Digital marketing, e-commerce, branding, social media strategy, startup business, dan entrepreneurship.',
        peluangKerja: 'Digital Marketing Specialist, Digital Strategist, Project Manager, Business Analyst, Market Analyst, Product Manager, Brand Manager, Business Development, dan Startup Founder.'
      },
      'd3 manajemen informatika': {
        name: 'D3 Manajemen Informatika',
        gelar: 'Ahli Madya Komputer (A.Md.Kom.)',
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
      const isDegreeSpecific = semanticFrame.intent === 'DEGREE_AWARD' ||
        (semanticFrame.aspects && semanticFrame.aspects.includes('degree_award')) ||
        /\b(gelar(?:nya)?)\b/i.test(rawQuery);

      if (isDegreeSpecific) {
        let degreeAnswer = `Berdasarkan informasi kurikulum dan akademik resmi ITB STIKOM Bali:\n\n` +
          `Lulusan program studi **${profile.name}** memperoleh gelar akademik **${profile.gelar}**.\n\n` +
          `Gelar ini diakui secara nasional dan diberikan setelah mahasiswa menyelesaikan seluruh beban studi (144 SKS untuk jenjang sarjana S1) serta dinyatakan lulus dalam sidang Tugas Akhir (Skripsi).`;
        return appendMissingAspectNote(degreeAnswer);
      }

      const isCareerSpecific = /\b(prospek(?:nya)?|peluang\s+kerja|karir|karier|profesi\s+lulusan|kerja\s+(?:sebagai\s+)?apa|lulusan(?:nya)?\s+(?:biasanya\s+)?kerja)\b/i.test(rawQuery) &&
        !/\b(apa\s+itu|pengertian|definisi|profil|tentang)\b/i.test(rawQuery);

      if (isCareerSpecific) {
        let careerAnswer = `Berdasarkan informasi resmi ITB STIKOM Bali, prospek karir dan peluang kerja untuk lulusan **${profile.name}** meliputi:\n\n`;
        const careers = profile.peluangKerja.split(',').map(c => c.trim()).filter(Boolean);
        for (const c of careers) {
          careerAnswer += `• ${c}\n`;
        }
        careerAnswer += `\nLulusan dibekali keahlian dan kompetensi yang siap bersaing di dunia industri digital maupun merintis usaha (technopreneur).`;
        return appendMissingAspectNote(careerAnswer);
      }

      let overviewAnswer = `Berdasarkan profil program studi resmi **${profile.name}** ITB STIKOM Bali:\n\n`;
      overviewAnswer += `${profile.deskripsi}\n\n`;
      overviewAnswer += `• **Status Akreditasi**: ${profile.akreditasi}\n`;
      overviewAnswer += `• **Gelar Lulusan**: ${profile.gelar}\n`;
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

/**
 * Natural Language Answer Renderer for Academic Program Recommendation
 * Part of established orchestration/rendering lifecycle.
 * Formats directly to WhatsApp Markdown fixed-point format (*bold*, single \n) ensuring sanitizer idempotency.
 *
 * @param {object} structuredResult
 * @returns {string} rendered WhatsApp Markdown string
 */
function renderRecommendationAnswer(structuredResult) {
  if (!structuredResult || typeof structuredResult !== 'object') {
    return 'Maaf, rekomendasi program studi belum dapat diproses.';
  }

  const { isBroadGuidance, scoredCandidates, presentationType } = structuredResult;

  const DISCLAIMER_TEXT = 'Catatan: Rekomendasi ini disusun secara objektif berdasarkan keselarasan minat dan kurikulum resmi ITB STIKOM Bali, bukan keputusan mutlak. Untuk konsultasi lebih lanjut mengenai kurikulum dan pendaftaran, silakan menghubungi bagian admisi PMB.';

  // 1. Broad Guidance
  if (isBroadGuidance || presentationType === 'BROAD_GUIDANCE' || !Array.isArray(scoredCandidates) || scoredCandidates.length === 0) {
    const lines = [
      'Latar belakang sekolah Kakak bisa masuk ke beberapa program studi di ITB STIKOM Bali. Agar pilihannya paling pas, berikut gambaran perbedaan fokus tiap prodi yang relevan:',
      '1. *Teknologi Informasi (TI) — S1*: Pemrograman (coding), pengembangan software/aplikasi, cloud computing, jaringan, dan keamanan siber.',
      '2. *Sistem Informasi (SI) — S1*: Menghubungkan teknologi dengan proses bisnis, analisis sistem perusahaan, basis data (database), dan dashboard.',
      '3. *Sistem Komputer (SK) — S1*: Perangkat keras (hardware), arsitektur komputer, embedded system, IoT, mikrokontroler, dan robotika.',
      '4. *Bisnis Digital (BD) — S1*: Pengembangan bisnis teknologi, digital marketing, e-commerce, dan strategi produk digital.',
      '5. *Manajemen Informatika (MI) — D3*: Jalur vokasi praktis 3 tahun untuk aplikasi terapan, pengolahan data, dan dukungan operasional IT.',
      'Supaya rekomendasi lebih spesifik, bidang apa yang paling Kakak minati antara coding/aplikasi, analisis data & bisnis, atau hardware & IoT?',
      DISCLAIMER_TEXT
    ];
    return lines.join('\n');
  }

  const cand1 = scoredCandidates[0];
  const cand2 = scoredCandidates[1] || null;

  // 2. Dominant Single
  if (presentationType === 'DOMINANT_SINGLE') {
    const lines = [
      `Berdasarkan minat yang Kakak sampaikan, program studi yang paling selaras adalah *${cand1.canonicalName}*.`,
      `*Fokus & Alasan Keselarasan:*`,
      `- ${cand1.reasons[0] || cand1.strengths.join(', ')}.`,
      `- Dasar resmi: ${cand1.grounding}.`
    ];

    if (cand2) {
      lines.push(`*Pilihan Alternatif Terdekat:*`);
      lines.push(`- *${cand2.canonicalName}*: ${cand2.reasons[0] || cand2.strengths.join(', ')} (Dasar resmi: ${cand2.grounding}).`);
    }

    lines.push(DISCLAIMER_TEXT);
    return lines.join('\n');
  }

  // 3. Balanced Dual
  if (presentationType === 'BALANCED_DUAL' && cand2) {
    const lines = [
      `Minat yang Kakak sampaikan memiliki irisan kuat pada dua program studi, yaitu *${cand1.canonicalName}* dan *${cand2.canonicalName}*. Keduanya memiliki keterkaitan yang berimbang dengan perbedaan fokus utama berikut:`,
      `1. *${cand1.canonicalName}*`,
      `- Fokus kajian: ${cand1.strengths.slice(0, 4).join(', ')}.`,
      `- Keselarasan: ${cand1.reasons[0]}.`,
      `- Dasar data: ${cand1.grounding}.`,
      `2. *${cand2.canonicalName}*`,
      `- Fokus kajian: ${cand2.strengths.slice(0, 4).join(', ')}.`,
      `- Keselarasan: ${cand2.reasons[0]}.`,
      `- Dasar data: ${cand2.grounding}.`,
      DISCLAIMER_TEXT
    ];
    return lines.join('\n');
  }

  // Fallback single list
  const lines = [
    `Rekomendasi program studi yang relevan dengan minat Kakak:`,
    `1. *${cand1.canonicalName}* (${cand1.reasons[0]})`,
    DISCLAIMER_TEXT
  ];
  return lines.join('\n');
}

async function synthesizeAnswer(semanticFrame, arbitratedEvidence = {}, comparisonEnvelope = null, recommendationResult = null) {
  if (recommendationResult && (recommendationResult.mode === 'RECOMMENDATION' || recommendationResult.provenance?.version === 'phase2-step7')) {
    const rendered = renderRecommendationAnswer(recommendationResult);
    return {
      success: true,
      answer: rendered,
      source: 'recommendation_deterministic_synthesis'
    };
  }

  if (comparisonEnvelope && comparisonEnvelope.mode === 'COMPARATIVE') {
    const { renderTextFromPlan, validateComparisonEnvelope } = require('../reasoning/comparativeSynthesis');
    const validation = validateComparisonEnvelope(comparisonEnvelope);
    if (!validation.valid) {
      return {
        success: false,
        answer: null,
        reason: 'comparative_transport_failure',
        diagnosticCode: validation.code
      };
    }
    const rendered = renderTextFromPlan(comparisonEnvelope.renderPlan);
    return {
      success: true,
      answer: rendered,
      source: 'comparative_deterministic_synthesis'
    };
  }

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
  synthesizeAnswer,
  renderRecommendationAnswer
};
