const {
  detectSensitiveInformation,
  maskPii,
  validateBusinessRules,
  validateCitation,
  estimateFinalConfidence
} = require('../engine/queryTechniqueLayer');

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (typeof raw === 'undefined') return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function stripDocumentSourceReferences(text) {
  let out = String(text || '');
  const fileExt = String.raw`(?:pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|webp|mp4|mp3)`;
  out = out.replace(new RegExp(String.raw`\s*\((?:sumber|source|file|filename|sourceFile|dokumen|document)\s*[:=-]\s*[^)]*\.${fileExt}\b[^)]*\)`, 'gi'), ' ');
  out = out.replace(new RegExp(String.raw`(?:^|\n)\s*(?:sumber|source|file|filename|sourceFile|dokumen|document)\s*[:=-]\s*[^\n]*\.${fileExt}\b[^\n]*`, 'gi'), '\n');
  out = out.replace(new RegExp(String.raw`\b(?:berdasarkan|mengacu pada|diambil dari|dari)\s+(?:dokumen|file|konteks\s+training|training\s+data|data\s+training)\s+[^\n.]{0,160}\.${fileExt}\b[^\n.]*[.]?`, 'gi'), '');
  out = out.replace(new RegExp(String.raw`\b(?:QNA|FAQ)\s+(?:Bot\s+-\s+)?[^\n.]{0,120}\.${fileExt}\b`, 'gi'), '');
  out = out.replace(/\b(?:berdasarkan|mengacu pada)\s+(?:konteks\s+training|training\s+data|data\s+training|chunk|retrieval)\b[,.]?\s*/gi, '');
  out = out.replace(/\b(?:trainingId|sourceFile|docCategory|ragChunkCount|ragIngestStatus|embedding)\s*[:=-]\s*[^\n]+/gi, '');
  return out;
}
function normalizeOutboundAnswerText(text) {
  let out = String(text || '');
  if (!out.trim()) return '';

  out = out.replace(/\u00A0/g, ' ');
  out = stripDocumentSourceReferences(out);
  const faqQuestionLabel = String.raw`(?:\([QF]\)|[QF]\s*[:.-]|FAQ\s*[:.-]|Question\s*[:.-]|Pertanyaan\s*[:.-]|Tanya\s*[:.-])`;
  const faqAnswerLabel = String.raw`(?:\(A\)|A\s*[:.-]|Answer\s*[:.-]|Jawaban\s*[:.-]|Jawab\s*[:.-])`;
  // Strip inline FAQ/QNA labels and keep only the answer portion for user-facing replies.
  out = out.replace(new RegExp(`^\\s*${faqQuestionLabel}\\s*[^?\\n]{3,260}\\?\\s*${faqAnswerLabel}\\s*`, 'i'), '');
  out = out.replace(new RegExp(`(?:^|\\n)\\s*${faqQuestionLabel}\\s*[^\\n]*\\?\\s*`, 'gim'), '\n');
  out = out.replace(new RegExp(`(?:^|\\s)${faqAnswerLabel}\\s*`, 'gi'), ' ');
  out = out.replace(new RegExp(`^\\s*(?:${faqQuestionLabel}|${faqAnswerLabel})\\s*`, 'gim'), '');
  out = out.replace(new RegExp(`(?:^|\\n)\\s*(?:${faqQuestionLabel}|${faqAnswerLabel})\\s*`, 'gim'), '\n');
  out = out.replace(new RegExp(`\\s+(?:${faqQuestionLabel}|${faqAnswerLabel})\\s*`, 'gi'), ' ');
  out = out.replace(/\u00e2\u20ac\u00a6/g, '...');
  out = out.replace(/([A-Za-z0-9)\]])\s*(?:\u2026|\.{3})(?=\s*(?:\n|$))/g, '$1.');
  out = out.replace(/\b(per|pendaftar|pertanyaan|informasi|program|fasilitas|dokumen|syarat|jadwal|gelombang)(?:\u2026|\.{3})\s*$/i, '$1.');
  out = out.replace(/\n\s*Kalau mau lanjut, kakak bisa tanya:\s*$/i, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function stripOptionalFollowupSuggestions(text) {
  let out = String(text || '').trim();
  if (envFlag('BOT_SHOW_FOLLOWUP_SUGGESTIONS', false)) return out;
  out = out.replace(/\n\s*(?:Kalau mau lanjut, kakak bisa tanya|Rekomendasi pertanyaan berikutnya):[\s\S]*$/i, '');
  out = out.replace(/\n\s*Kalau Kakak ingin tahu lebih lanjut, mungkin pertanyaan berikut(?:nya)? juga bisa membantu:[\s\S]*$/i, '');
  out = out.replace(/(?:^|\n)\s*Kalau kakak mau, saya (?:juga )?bisa (?:tampilkan|jelaskan|bantu jelaskan)[^\n]*\.?\s*/gi, '\n');
  out = out.replace(/\n\s*Agar saya bisa membantu lebih baik, coba tuliskan pertanyaan dengan lebih spesifik\.?\s*$/i, '');
  return out.trim();
}

function hasRawTechnicalLeak(text) {
  const out = String(text || '');
  return /\b(?:SOURCE_CHUNKS|CONFIDENCE|CONTEXT:|ASSIST_HINTS|TRACE_|relevance_audit|trainingId|sourceFile|ragChunkCount|ragIngestStatus|docCategory|embedding)\b/i.test(out);
}

function hasDocumentSourceLeak(text) {
  const out = String(text || '');
  const fileExtLeak = /\b[\w .()\[\]-]{2,160}\.(?:pdf|docx?|xlsx?|pptx?|txt|csv|jpg|jpeg|png|webp|mp4|mp3)\b/i.test(out);
  const explicitSourceLeak = /\b(?:sumber|source|file|filename|sourceFile|dokumen|document)\s*[:=-]\s*[^\n]{3,180}/i.test(out);
  const trainingPhraseLeak = /\b(?:berdasarkan|mengacu pada|diambil dari|dari)\s+(?:dokumen|file|konteks\s+training|training\s+data|data\s+training|chunk|retrieval)\b/i.test(out);
  const qnaFileLeak = /\b(?:QNA|FAQ)\s+(?:Bot\s+-\s+)?[A-Za-z0-9 ._-]{2,80}\b/i.test(out) && /\b(?:dokumen|file|source|sumber|docx|pdf)\b/i.test(out);
  return fileExtLeak || explicitSourceLeak || trainingPhraseLeak || qnaFileLeak;
}
function isExplicitLegalDocumentQuestion(userQuery) {
  return /\b(?:isi\s+)?pasal\s+\d+|ayat\s*\(\d+\)|force\s+majeure|addendum|klausul|perjanjian|kontrak|nota\s+kesepahaman|mou|moa|pihak\s+pertama|pihak\s+kedua|dokumen\s+(?:legal|hukum|kerja\s*sama)|surat\s+keputusan|\bSK\b/i.test(String(userQuery || ''));
}

function hasUnsafeAdministrativeLeak(answer, userQuery = '') {
  if (isExplicitLegalDocumentQuestion(userQuery)) return false;
  const out = String(answer || '');
  const rawMarkers = [
    /\bPasal\s+\d+[a-z]?\b/i,
    /\bayat\s*\(\d+\)/i,
    /\bPIHAK\s+(?:PERTAMA|KESATU|KEDUA)\b/i,
    /\bPARA\s+PIHAK\b/i,
    /\bPERJANJIAN\s+KERJA\s*SAMA\b/i,
    /\bNOTA\s+KESEPAHAMAN\b/i,
    /\bIMPLEMENTATION\s+ARRANGEMENT\b/i,
    /\bFORCE\s+MAJEURE\b/i,
    /\bADDENDUM\b/i,
    /\bMenimbang\s*:/i,
    /\bMengingat\s*:/i,
    /\bMemutuskan\s*:/i,
    /\bDitetapkan\s+di\b/i,
    /\bNomor\s*:\s*\d+\s*\/\s*SK\b/i,
    /\b(?:tanda\s+tangan|bermeterai|stempel|tembusan|lampiran|perihal)\b/i,
    /\bmempunyai\s+kekuatan\s+hukum\s+yang\s+sama\b/i
  ];
  return rawMarkers.some((pattern) => pattern.test(out));
}
function hasRawFaqQnaDump(text) {
  const out = String(text || '');
  const inlineFaqMarkerCount = (out.match(/\((?:F|Q|A)\)/gi) || []).length;
  const lineFaqMarkerCount = (out.match(/(?:^|\n)\s*(?:FAQ|QNA|Q|A|F|Question|Answer|Pertanyaan|Jawaban|Tanya|Jawab)\s*[:\-.]/gi) || []).length;
  const hasFaqHeaderWithQa = /(?:^|\n)\s*(?:FAQ|QNA)\s*[:\-.]/i.test(out) && lineFaqMarkerCount >= 2;
  const hasInlineFactQuestionAnswer = /\(F\)[\s\S]{0,500}\(Q\)[\s\S]{0,500}\(A\)/i.test(out)
    || /\bF\s*[:.-][\s\S]{0,500}\bQ\s*[:.-][\s\S]{0,500}\bA\s*[:.-]/i.test(out);

  // Configurable thresholds: increased from 2,3 to 4,5 to reduce false positives
  const inlineFaqThreshold = parseInt(process.env.PREFLIGHT_INLINE_FAQ_THRESHOLD || '4', 10);
  const lineFaqThreshold = parseInt(process.env.PREFLIGHT_LINE_FAQ_THRESHOLD || '5', 10);

  const result = hasInlineFactQuestionAnswer || inlineFaqMarkerCount >= inlineFaqThreshold || lineFaqMarkerCount >= lineFaqThreshold || hasFaqHeaderWithQa;

  if (process.env.PREFLIGHT_DEBUG_DETAILED) {
    console.log('[PREFLIGHT] hasRawFaqQnaDump:', {
      inline: inlineFaqMarkerCount,
      inlineThreshold: inlineFaqThreshold,
      line: lineFaqMarkerCount,
      lineThreshold: lineFaqThreshold,
      hasFaqHeader: hasFaqHeaderWithQa,
      result
    });
  }

  return result;
}
function hasLikelyRawDocumentLeak(text) {
  const out = String(text || '');
  const lower = out.toLowerCase();
  const legalMarkers = [
    /\bpasal\s+\d+/i,
    /\bpihak\s+pertama\b/i,
    /\bpihak\s+kedua\b/i,
    /\baddendum\b/i,
    /\bperjanjian\s+kerja\s+sama\b/i,
    /\bimplementation\s+arrangement\b/i,
    /\bnota\s+kesepahaman\b/i,
    /\bpara\s+pihak\b/i,
    /\bforce\s+majeure\b/i,
    /\bmempunyai\s+kekuatan\s+hukum\s+yang\s+sama\b/i,
    /\b(?:nama|logo)\s+mitra\b/i,
    /\bAlamat\s+Telepon\s+E\s*-\s*mail\b/i,
    /\bJalan\s+Raya\s+Puputan\s+Nomor\s+86\b/i,
    /\btemplate\s+PKS\b/i
  ];
  const faqMarkerCount = (out.match(/(?:^|\n)\s*(?:FAQ|QNA|Q|A|F|Question|Answer|Pertanyaan|Jawaban|Tanya|Jawab)\s*[:\-.]/gi) || []).length;
  const inlineFaqMarkerCount = (out.match(/\((?:F|Q|A)\)/gi) || []).length;
  const legalMarkerCount = legalMarkers.filter((re) => re.test(out)).length;
  const profileMarkers = [
    /\bPROFIL\s+LEMBAGA\b/i,
    /\bIdentitas\s+Lembaga\b/i,
    /\bNama\s+Lembaga\b/i,
    /\bTahun\s+Berdiri\b/i,
    /\bDasar\s+Hukum\b/i,
    /\bPembina\s*\/\s*Penanggung\s+Jawab\b/i,
    /\bRingkasan\s+Capaian\b/i,
    /\b(?:Tim|Wirausaha)\s+(?:Wirausaha\s+)?Binaan\b/i,
    /\bAlamat\s+Kampus\b/i,
    /\bWebsite\s+ibt\.stikom-bali\.ac\.id\b/i
  ];
  const profileMarkerCount = profileMarkers.filter((re) => re.test(out)).length;
  const documentStructureMarkers = [
    /\b(?:PROFIL|PROFILE)\s+(?:LEMBAGA|ORGANISASI|DIVISI|UNIT|UKM|PROGRAM)\b/i,
    /\b(?:BAB|BAGIAN)\s+[IVX\d]+\b/i,
    /\bDAFTAR\s+ISI\b/i,
    /\b(?:Latar\s+Belakang|Maksud\s+dan\s+Tujuan|Ruang\s+Lingkup)\b/i,
    /\b(?:Visi|Misi)\s*[:\uFF1A]/i,
    /\b(?:Nama|Alamat|Website|Email|E-mail|Telepon|No\.?\s*SK|Nomor\s+SK)\s*[:\uFF1A]/i,
    /\b(?:Pembina|Ketua|Sekretaris|Bendahara|Koordinator|Penanggung\s+Jawab)\s*[:\uFF1A]/i,
    /\b(?:Struktur\s+Organisasi|Susunan\s+Pengurus|Identitas\s+(?:Lembaga|Organisasi|Program))\b/i,
    /\b(?:Lampiran|Tembusan|Ditetapkan\s+di|Pada\s+tanggal|Menetapkan|Memutuskan)\b/i,
    /\b(?:Narahubung|Contact\s+Person|CP)\s*[:\uFF1A]/i
  ];
  const structureMarkerCount = documentStructureMarkers.filter((re) => re.test(out)).length;
  const labelValueCount = (out.match(/\b[A-Za-z][A-Za-z0-9\s/().-]{2,38}\s*:\s*\S/g) || []).length;

  // Configurable threshold: increased from 5 to 8 to reduce false positives on curriculum descriptions
  const labelValueThreshold = parseInt(process.env.PREFLIGHT_LABEL_VALUE_THRESHOLD || '8', 10);
  const denseInlineProfile = out.length > 550 && labelValueCount >= labelValueThreshold;
  const repeatedDocumentHeader = /\b(?:PROFIL|PROFILE|KEPUTUSAN|SURAT\s+KEPUTUSAN|PERJANJIAN|NOTA\s+KESEPAHAMAN|MOU|MOA)\b[\s\S]{0,260}\b(?:Nama|Alamat|Nomor|Tahun|Dasar\s+Hukum|Pembina|Penanggung\s+Jawab)\b/i.test(out);
  const inlineAnswerCount = (out.match(/\b(?:Jawaban|Answer|Jawab|A)\s*[:\-.]/gi) || []).length;
  const questionMarkCount = (out.match(/\?/g) || []).length;
  const qnaSequenceLike = /\b(?:FAQ|QNA|INFORMASI\s+UMUM)\b/i.test(out) && (inlineAnswerCount >= 1 || questionMarkCount >= 1);
  const formTableMarkers = [
    /\bFORM\s+IKU\b/i,
    /\bPersentase\s+PTS\b/i,
    /\bPerguruan\s+Tinggi\b/i,
    /\bJumlah\s+Total\b/i,
    /\bYa\s*\/\s*Tidak\b/i,
    /\b(?:A|B|C)\.\s+[A-Z][A-Za-z\s]{8,}/,
    /\b(?:Passpor|Passport|KITAS|ITAS|SKTT|VITAS|LoA|Financial\s+Statement|Medical\s+Statement)\b/i
  ];
  const formTableMarkerCount = formTableMarkers.filter((re) => re.test(out)).length;
  const fragmentedLineCount = out.split(/\n+/).filter((line) => {
    const t = line.trim();
    return t.length > 0 && t.length <= 38 && !/[.!?]$/.test(t);
  }).length;
  const residualQnaLike = (questionMarkCount >= 2
    || /\?\s+(?:Dokumen|Syarat|Visa|Biaya|Masa|Tidak|Umumnya|Proses|SKTT|ITAS|Izin|Program|Mahasiswa|Apakah|Bagaimana|Berapa)\b/i.test(out))
    && /\b(?:dokumen|syarat|visa|itas|izin\s+belajar|mahasiswa\s+asing|biaya|program|passport|passpor|kitas|sktt)\b/i.test(out);
  const documentChecklistLike = /\bsbb\s*:/i.test(out)
    || ((out.match(/\b(?:Passport|Passpor|KITAS|ITAS|SKTT|VITAS|LoA|Financial\s+Statement|Medical\s+Statement|Statement\s+Letter|Academic\s+Transcripts|Form\s+F1-01)\b/gi) || []).length >= 3);
  const tableRowLike = /^\s*\d+\s*\|/m.test(out) || /\bmeliputi\s*:\s*(?:\n|\s)*\d+[.)]/i.test(out);
  const institutionalFormLike = /\b(?:PTS|Perguruan\s+Tinggi|Program\s+Studi)\b/i.test(out) && /\b(?:Persentase|Jumlah\s+Total|Ya\s*\/\s*Tidak|kegiatan\s+pembelajaran\s+di\s+luar)\b/i.test(out);
  const spreadsheetExtractionLike = /^\s*\[Sheet:\s*[^\]]+\]/i.test(out)
    || ((out.match(/\s\|\s/g) || []).length >= 3)
    || /\b(?:visi|misi|tujuan|layanan|program)\s*\|\s*/i.test(out);
  const bareFormFieldLike = out.length <= 120
    && /\b(?:Nama|Kode|Program\s+Studi|Perguruan\s+Tinggi|Jumlah|Keterangan|Tahun)\b/i.test(out)
    && /:\s*$/.test(out.trim());
  const rawHeadingLike = out.length <= 140
    && /\b(?:FORMULIR\s+DATA|DATA\s+YANG\s+DIPERLUKAN|INDIKATOR\s+KINERJA|STRUKTUR\s+ORGANISASI|SUSUNAN\s+PENGURUS)\b/i.test(out);
  const numberedSectionLike = /\b\d+\.\s+(?:Struktur\s+Organisasi|Layanan\s+dan\s+Program|Identitas\s+Lembaga|Ringkasan\s+Capaian|Ruang\s+Lingkup|Tujuan|Pelaksanaan)\b/i.test(out);
  const rawStaffRosterLike = /\b(?:Pembina|Kepala|Manajer|Asisten\s+Manajer|Koordinator|Staff|Staf|Direktur)\b/i.test(out)
    && /\b(?:S\.Kom|M\.Kom|S\.TI|M\.T|S\.E|M\.M|Dr\.|Ir\.)\b/i.test(out)
    && ((out.match(/\b(?:Pembina|Kepala|Manajer|Asisten\s+Manajer|Koordinator|Staff|Staf|Direktur)\b/gi) || []).length >= 2);
  const rawCooperationRosterLike = /\b(?:Bentuk\s+Kolaborasi|penandatanganan\s+MoU|Mitra\s+komunitas|Akademisi|Pemerintah|Industri)\b/i.test(out)
    && /\b(?:Dinas|Kementerian|UMKM|SMA|SMK|Universitas|Lembaga|Komunitas)\b/i.test(out);
  const rawProfileIntroLike = out.length > 180
    && /^\s*(?:PROFIL|PROFILE|Company\s+Profile)\b/i.test(out);
  const rawSectionContentLike = /\b(?:PENDAHULUAN|Ruang\s+Lingkup|MEKANISME\s*&\s*ALUR|ALUR\s+PENGAJUAN|Kriteria\s+Mitra)\b/i.test(out)
    && out.length > 220;
  const institutionalCriteriaLike = /\b(?:perguruan\s+tinggi|program\s+studi|prodi|mahasiswa\s+inbound)\b/i.test(out)
    && /\b(?:Jumlah|Kriteria|Indikator|Triwulan|Akreditasi|pembelajaran\s+di\s+luar\s+program|QS200)\b/i.test(out)
    && ((out.match(/\b\d+[.)]/g) || []).length >= 2 || /\b[a-e]\)/i.test(out));
  const choppedFragmentLike = out.length > 180
    && /^[a-z]/.test(out.trim())
    && !/[.!?)]\s*$/.test(out.trim());
  const ocrHtmlArtifactLike = /&(?:amp|lt|gt|nbsp);/i.test(out)
    || /\b(?:k\s+ekuatan|Tri\s+d\s+arma|startup\s+compang|1ain)\b/i.test(out);
  const ocrSourceLike = /\b(?:Teks\s+hasil\s+OCR|hasil\s+OCR\s+gambar|CATATAN\s+UNTUK|bahan\s+referensi\s*\/\s*(?:administrasi|koordinasi))\b/i.test(out);
  const rawProfileTitleOnlyLike = out.length <= 180
    && /^\s*(?:PROFIL|PROFILE|Company\s+profile|Profiling)\b/i.test(out)
    && !/[.!?]/.test(out);
  const rawCertificateLike = /\b(?:Badan\s+Akreditasi\s+Nasional\s+Perguruan\s+Tinggi|BAN-PT|Surat\s+Keputusan\s+Direktur\s+Dewan\s+Eksekutif)\b/i.test(out)
    && /\b(?:No\.|Nomor|menyatakan\s+bahwa|Program\s+Studi)\b/i.test(out);
  const partialLeadingFragmentLike = out.length > 160
    && /^[a-z]/.test(out.trim())
    && /\b(?:perguruan\s+tinggi|visi\s+misi|dies\s+natalis|program|kegiatan|mahasiswa|organisasi|layanan)\b/i.test(out);
  const embeddedRawHeadingLike = out.length > 240
    && /\b(?:KEGIATAN\s*&\s*PERAN\s+UTAMA|DESKRIPSI\s+ORMAWA|FOKUS\s*&\s*KEGIATAN\s+UTAMA|CATATAN|Misi\s*:)\b/.test(out);
  const rawSkHeadingLike = out.length <= 180
    && /\b(?:SURAT\s+KEPUTUSAN|AKREDITASI\s+NASIONAL\s+PERGURUAN\s+TINGGI|PENETAPAN\s+PEMBINA|SUSUNAN\s+PEMBINA|DIREKTUR\s+DEWAN\s+EKSEKUTIF)\b/i.test(out);
  const rawOrmawaRosterTableLike = /\bNO\.?\s+ORMAWA\s+PEMBINA\s+(?:KOORDINATOR|PENDAMPING)\b/i.test(out)
    || (/\b(?:BEM|DPM|ATHENA|PMK|U2M|D\.O\.S|MCOS)\b/i.test(out) && ((out.match(/\bS\.KOM|\bM\.KOM|\bM\.T|\bMM\.SI|\bSE\./gi) || []).length >= 2));
  const brokenProfileOcrLike = /\bLOG\s+O\s+PROFILE\b/i.test(out)
    || /\bDESKRIPSI\s+ORMAWA\s*:/i.test(out);
  const numberedProfileSynopsisLike = /\bprofil\s+singkat\s+mengenai\s+UKM\b/i.test(out)
    && /\b\d+\.\s+(?:Fokus|Kegiatan|Program|Tujuan|Struktur)\b/i.test(out);
  const rawAccreditationHeadingLike = out.length <= 180
    && /\bKONVERSI\s+PERINGKAT\s+AKREDITASI\s+PERGURUAN\s+TINGGI\b/i.test(out);
  const placeholderLike = /_{5,}|\.{8,}|:{3,}|\?{4,}|(?:nomor\s*:\s*(?:\.{4,}|\?{4,}|\([^)]*\)))|(?:E\s*-\s*mail\s*:::)/i.test(out);

  // ISSUE #1 FIX: Detect curriculum descriptions to skip strict document leak checks
  // These are naturally dense with learning keywords and shouldn't trigger document leaks
  const looksLikeCurriculumDescription = /\b(?:belajar|mempelajari|fokus|skill|kompetensi|kemampuan|pengembangan|materi|mata\s+kuliah|skill\s+yang\s+dibangun|keahlian)\b/i.test(out)
    && /\b(?:pemrograman|data|keamanan|teknologi|sistem|bisnis|digital|marketing|analisis|development|infrastruktur|machine\s+learning|iot|arsitektur|basis\s+data|jaringan|cloud)\b/i.test(out);

  // Skip strict document leak checks if curriculum description detected
  if (looksLikeCurriculumDescription) {
    if (process.env.PREFLIGHT_DEBUG_DETAILED) {
      console.log('[PREFLIGHT] Curriculum description - skipping strict hasLikelyRawDocumentLeak checks');
    }
    // Only check for most critical leaks (legal, OCR artifacts, placeholders)
    return legalMarkerCount >= 2 || ocrHtmlArtifactLike || ocrSourceLike || placeholderLike;
  }

  return faqMarkerCount >= 2
    || inlineFaqMarkerCount >= 2
    || legalMarkerCount >= 2
    || profileMarkerCount >= 3
    || structureMarkerCount >= 4
    || denseInlineProfile
    || qnaSequenceLike
    || formTableMarkerCount >= 2
    || residualQnaLike
    || documentChecklistLike
    || tableRowLike
    || institutionalFormLike
    || spreadsheetExtractionLike
    || bareFormFieldLike
    || rawHeadingLike
    || numberedSectionLike
    || rawStaffRosterLike
    || rawCooperationRosterLike
    || rawProfileIntroLike
    || rawSectionContentLike
    || institutionalCriteriaLike
    || choppedFragmentLike
    || ocrHtmlArtifactLike
    || ocrSourceLike
    || rawProfileTitleOnlyLike
    || rawCertificateLike
    || partialLeadingFragmentLike
    || embeddedRawHeadingLike
    || rawSkHeadingLike
    || rawOrmawaRosterTableLike
    || brokenProfileOcrLike
    || numberedProfileSynopsisLike
    || rawAccreditationHeadingLike
    || (formTableMarkerCount >= 1 && fragmentedLineCount >= 4)
    || repeatedDocumentHeader
    || (profileMarkerCount >= 2 && out.length > 700)
    || (structureMarkerCount >= 2 && out.length > 900)
    || (legalMarkerCount >= 1 && placeholderLike)
    || (lower.includes('pasal') && lower.includes('pihak pertama') && lower.includes('pihak kedua'));
}


function recoverSafeSummaryFromLeakyAnswer(answer, userQuery = '') {
  const original = String(answer || '');
  if (!original.trim()) return '';

  let cleaned = normalizeOutboundAnswerText(stripOptionalFollowupSuggestions(original));
  cleaned = cleaned.replace(/\bFakta internal\b[.:-]?\s*/gi, ' ');
  cleaned = cleaned.replace(/\bFAQ\s*:\s*Jangan tampilkan format ini\.?/gi, ' ');
  cleaned = cleaned.replace(/\bJangan tampilkan format ini\.?/gi, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const rawLineMarker = new RegExp(String.raw`\b(?:PROFIL|PROFILE)\s+(?:LEMBAGA|ORGANISASI|DIVISI|UNIT|UKM|PROGRAM)|\b(?:FAQ|QNA|INFORMASI\s+UMUM)\b|\b(?:Pertanyaan|Question|Tanya|Q|Jawaban|Answer|Jawab|A)\s*[:\-.]|\bDAFTAR\s+ISI\b|\b(?:BAB|BAGIAN)\s+[IVX\d]+\b|\b(?:Identitas\s+(?:Lembaga|Organisasi|Program)|Nama\s+Lembaga|Tahun\s+Berdiri|Dasar\s+Hukum|Pembina\s*/\s*Penanggung\s+Jawab|Ringkasan\s+Capaian|Struktur\s+Organisasi|Susunan\s+Pengurus|Nomor\s+SK|Surat\s+Keputusan\s+Pendirian|SURAT\s+KEPUTUSAN|Menimbang|Mengingat|Memutuskan|Ditetapkan\s+di|Pada\s+tanggal|Tembusan|Lampiran|PIHAK\s+PERTAMA|PIHAK\s+KEDUA|Pasal\s+\d+|NOTA\s+KESEPAHAMAN|PERJANJIAN\s+KERJA\s+SAMA|FORM\s+IKU|Persentase\s+PTS|Ya\s*/\s*Tidak|Jumlah\s+Total|Passpor|Passport|KITAS|ITAS|SKTT|VITAS)\b`, 'i');
  const queryTerms = normalizeForAlignment(userQuery).split(/\s+/).filter((word) => word.length >= 4 && !/^(yang|dari|untuk|dengan|atau|kakak|kalau|bagaimana|gimana|seperti|program|fasilitas)$/.test(word));
  const hasQueryOverlap = (value) => !queryTerms.length || queryTerms.some((term) => normalizeForAlignment(value).includes(term));
  const chunks = cleaned
    .split(/(?:\n+|(?<=[.!?])\s+(?=[A-Z0-9]))/)
    .map((item) => item.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);

  const safeChunks = [];
  for (const chunk of chunks) {
    if (safeChunks.length >= 4) break;
    if (chunk.length < 24 || chunk.length > 360) continue;
    if (rawLineMarker.test(chunk)) continue;
    if (hasRawTechnicalLeak(chunk) || hasDocumentSourceLeak(chunk)) continue;
    if (hasUnsafeAdministrativeLeak(chunk, userQuery) || hasLikelyRawDocumentLeak(chunk)) continue;
    if (!hasQueryOverlap(chunk) && safeChunks.length === 0) continue;
    safeChunks.push(chunk.replace(/\s{2,}/g, ' '));
  }

  const recovered = safeChunks.join('\n\n').trim();
  if (recovered.length >= 24 && recovered.length <= 900) return recovered;

  if (cleaned.length >= 24 && cleaned.length <= 650
    && !rawLineMarker.test(cleaned)
    && !hasRawTechnicalLeak(cleaned)
    && !hasDocumentSourceLeak(cleaned)
    && !hasUnsafeAdministrativeLeak(cleaned, userQuery)
    && !hasLikelyRawDocumentLeak(cleaned)
    && hasQueryOverlap(cleaned)) {
    return cleaned;
  }

  return '';
}
const INTENT_PATTERNS = {
  fee: [/\b(biaya(?:nya)?|harga(?:nya)?|tarif|ukt|dpp|spp|uang|uang\s+kuliah|uang\s+masuk|bayar(?:an|nya)?|pembayaran|tagihan|angsuran|cicil|cicilan|dicicil|nyicil|nominal|total(?:an)?|potongan\s+biaya)\b/i],
  schedule: [/\b(jadwal(?:nya)?|kapan|tanggal(?:nya)?|deadline|batas|timeline|periode|gelombang|dibuka|ditutup|tutup|mulai|berakhir|pendaftaran\s+sekarang|bulan\s+(?:ini|depan))\b/i],
  ukm: [/\b(ukm(?:nya)?|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|komunitas|himpunan|hima|athena(?:\s+e-?sports?)?|ghost|e-?sports?|gaming|game\s+kompetitif|olahraga|sport|musik|futsal|basket|teater\s+biner|vos|vokal|paduan\s+suara|kegiatan\s+mahasiswa)\b/i],
  scholarship: [/\b(beasiswa|kip|1k1s|bantuan\s+biaya|potongan\s+dpp|prestasi)\b/i],
  double_degree: [/\b(double\s*degree|dual\s*degree|dd|utb|dnui|help\s+university|gelar\s+ganda|program\s+ganda|kampus\s+mitra|partner)\b/i],
  facility: [/\b(fasilitas|layanan|sarana|prasarana|career\s*center|pusat\s+kar(?:i|ie)r|cdc|inkubator\s+bisnis|inbis|incubator\s+bisnis|language\s+learning\s+center|llc|pusat\s+bahasa|kursus\s+bahasa|softskill|gccp|bccp|student\s*exchange|exchange\s+program|hi-?think|belajar\s+bahasa|kemampuan\s+bahasa)\b/i],
  program: [/\b(prodi|program\s+studi|pilihan\s+prodi|peminatan|jurusan|kuliah|s1|d3|s2|diploma|manajemen\s+informatika|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer)\b/i],
  registration: [/\b(cara\s+(?:daftar|masuk|gabung|join)|join|bergabung|mendaftar|registrasi|pendaftaran\s+online|formulir|link\s+daftar|syarat\s+(?:daftar|pendaftaran)|dokumen\s+pendaftaran)\b/i]
};

const OFF_TOPIC_INTENTS = {
  ukm: ['fee', 'schedule', 'scholarship', 'double_degree', 'registration'],
  fee: ['ukm', 'facility', 'double_degree'],
  schedule: ['ukm', 'facility', 'double_degree', 'scholarship'],
  scholarship: ['ukm', 'facility', 'double_degree'],
  double_degree: ['ukm', 'fee', 'scholarship'],
  facility: ['fee', 'schedule', 'scholarship', 'double_degree'],
  registration: ['ukm', 'facility', 'double_degree']
};

function isConversationalQuery(userQuery) {
  const q = normalizeForAlignment(userQuery);
  if (!q) return false;
  if (detectIntentSet(q).size) return false;
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;
  const normalizedRepeats = q.replace(/([a-z])\1+/gi, '$1');
  const greetingToken = String.raw`(?:halo|hallo|hello|helo|hai|hi|hey|bro|sis|min|admin|kak|gan|pagi|siang|sore|malam|permisi|assalamualaikum|salam)`;
  const politeTail = String.raw`(?:kak|kakak|min|admin|bro|sis|gan|ya|dong|nih)?`;
  const greetingOnlyPattern = new RegExp(String.raw`^(?:${greetingToken}|selamat\s+(?:pagi|siang|sore|malam))(?:\s+(?:${greetingToken}|selamat\s+(?:pagi|siang|sore|malam)))*\s*${politeTail}$`, 'i');
  return greetingOnlyPattern.test(normalizedRepeats)
    || /^(?:apa\s+kabar|gimana\s+kabarnya|bagaimana\s+kabarnya)(?:\s+(?:kak|kakak|min|admin))?$/i.test(normalizedRepeats)
    || /^(?:test|tes|testing|cek|ping)(?:\s+(?:bot|kak|min|admin))?$/i.test(normalizedRepeats)
    || /^(?:makasih|terima\s+kasih|thanks|thank\s+you)(?:\s+(?:kak|kakak|min|admin|ya))?$/i.test(normalizedRepeats)
    || /^(?:ok|oke|okey|okay|siap|baik|noted|mantap)(?:\s+(?:kak|kakak|min|admin|ya))?$/i.test(normalizedRepeats)
    || /^(?:boleh\s+)?(?:mau\s+)?(?:tanya|bertanya|nanya)(?:\s+(?:kak|kakak|min|admin))?$/i.test(normalizedRepeats)
    || /^(?:boleh\s+tanya|mau\s+tanya|izin\s+tanya)(?:\s+(?:kak|kakak|min|admin))?$/i.test(normalizedRepeats);
}

function buildConversationalFallback(userQuery) {
  const q = normalizeForAlignment(userQuery);
  if (/\b(?:makasih|terima\s+kasih|thanks|thank\s+you)\b/i.test(q)) {
    return 'Sama-sama, kak. Kalau ada yang ingin ditanyakan seputar ITB STIKOM Bali, silakan chat lagi ya.';
  }
  if (/\b(?:ok|oke|okey|siap|baik)\b/i.test(q)) {
    return 'Siap, kak. Ada yang bisa saya bantu lagi seputar ITB STIKOM Bali?';
  }
  if (/\b(?:apa\s+kabar|gimana\s+kabarnya|bagaimana\s+kabarnya)\b/i.test(q)) {
    return 'Baik, kak. Ada yang bisa saya bantu seputar ITB STIKOM Bali?';
  }
  return 'Halo kak, ada yang bisa saya bantu seputar ITB STIKOM Bali?';
}

function isGenericRecoveryFallbackText(answer) {
  return /\b(?:belum\s+mempunyai\s+jawaban\s+yang\s+cukup\s+aman|jawaban\s+yang\s+terbentuk\s+belum\s+sesuai|sistem\s+kami\s+sedang\s+kendala|pesan\s+tadi\s+belum\s+terbaca|belum\s+kebaca\s+dengan\s+benar|belum\s+menemukan\s+informasi\s+yang\s+cukup)\b/i.test(String(answer || ''));
}

function detectIntentSet(text) {
  const out = new Set();
  const value = String(text || '');
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    if (patterns.some((re) => re.test(value))) out.add(intent);
  }
  return out;
}

function normalizeForAlignment(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getContentTerms(text) {
  const stopwords = new Set([
    'apa', 'apakah', 'bagaimana', 'gimana', 'kalau', 'terkait', 'tentang', 'untuk',
    'yang', 'dengan', 'dalam', 'oleh', 'dari', 'itu', 'ini', 'kak', 'kakak', 'min',
    'saya', 'aku', 'mau', 'ingin', 'menanyakan', 'bertanya', 'baik', 'oke', 'ok',
    'punya', 'mempunyai', 'ada', 'saja', 'admin', 'tolong', 'jelaskan', 'info',
    'informasi', 'detail', 'lengkap', 'dong', 'ya', 'nih', 'nya', 'dan', 'atau',
    'di', 'ke', 'se', 'bisa', 'dapat', 'mohon'
  ]);
  const importantShortTerms = new Set([
    'ti', 'si', 'bd', 'sk', 'mi', 'llc', 'd3', 's1', 's2', 'dkv', 'trpl', 'tk',
    'mm', 'an', 'dg', 'rpl', 'utb', 'dnui', 'help', 'bccp', 'gccp'
  ]);
  return normalizeForAlignment(text)
    .split(/\s+/)
    .filter((term) => {
      const cleaned = String(term || '').toLowerCase();
      if (!cleaned) return false;
      return (cleaned.length >= 3 || importantShortTerms.has(cleaned)) && !stopwords.has(cleaned);
    });
}

function detectRequiredEntities(text) {
  const value = String(text || '').toLowerCase();
  const entities = [];
  const rules = [
    { key: 'gccp', patterns: [/\bgccp\b/i] },
    { key: 'bccp', patterns: [/\bbccp\b/i] },
    { key: 'linkedin', patterns: [/\blinked\s*in\b/i, /\blinkedin\b/i] },
    { key: 'language learning center', patterns: [/\blanguage\s+learning\s+center\b/i, /\bllc\b/i, /belajar\s+bahasa/i, /kemampuan\s+bahasa/i] },
    { key: 'career center', patterns: [/\bcareer\s*center\b/i, /pusat\s+kar(?:ir|ier)/i] },
    { key: 'softskill', patterns: [/\bsoft\s*skill\b/i, /\bsoftskill\b/i] },
    { key: 'ukm', patterns: [/\bukm\b/i, /ormawa/i, /unit\s+kegiatan\s+mahasiswa/i, /organisasi\s+mahasiswa/i] },
    { key: 'ksl', patterns: [/\bksl\b/i, /kelompok\s+studi\s+linux/i] },
    { key: 'athena', patterns: [/\bathena\b/i, /athena\s+esports?/i] },
    { key: 'ghost', patterns: [/\bghost\b/i] },
    { key: 'esport', patterns: [/\besports?\b/i, /athena\s+esports?/i] },
    { key: 'double degree', patterns: [/double\s*degree/i, /dual\s*degree/i, /gelar\s+ganda/i] },
    { key: 'dnui', patterns: [/\bdnui\b/i, /dalian\s+neusoft/i] },
    { key: 'utb', patterns: [/\butb\b/i, /universitas\s+teknologi\s+bandung/i] },
    { key: 'help', patterns: [/\bhelp\b/i, /help\s+university/i] },
    { key: 'sistem informasi', patterns: [/sistem\s+informasi/i, /\bsi\b/i] },
    { key: 'teknologi informasi', patterns: [/teknologi\s+informasi/i, /\bti\b/i] },
    { key: 'bisnis digital', patterns: [/bisnis\s+digital/i, /\bbd\b/i] },
    { key: 'sistem komputer', patterns: [/sistem\s+komputer/i, /\bsk\b/i] },
    { key: 'manajemen informatika', patterns: [/manajemen\s+informatika/i, /\bmi\b/i] }
  ];
  for (const rule of rules) {
    if (rule.patterns.some((pattern) => pattern.test(value))) entities.push(rule.key);
  }
  return entities;
}

function answerMentionsEntity(answer, entity) {
  const value = normalizeForAlignment(answer);
  const aliases = {
    'language learning center': ['language learning center', 'llc', 'belajar bahasa', 'kemampuan bahasa'],
    'career center': ['career center', 'pusat karier', 'pusat karir'],
    'hi-think': ['hi think', 'hithink', 'jepang', 'industri teknologi'],
    'inkubator bisnis': ['inkubator bisnis', 'inbis', 'startup', 'usaha', 'bisnis'],
    ukm: ['ukm', 'ormawa', 'unit kegiatan mahasiswa', 'organisasi mahasiswa', 'kegiatan mahasiswa', 'wadah mahasiswa', 'komunitas mahasiswa', 'himpunan mahasiswa', 'kelompok studi'],
    athena: ['athena', 'athena esport', 'athena esports'],
    esport: ['esport', 'esports', 'athena esport', 'athena esports', 'kompetisi game', 'gaming'],
    ghost: ['ghost'],
    ksl: ['ksl', 'kelompok studi linux'],
    'double degree': ['double degree', 'dual degree', 'gelar ganda'],
    'sistem informasi': ['sistem informasi', 'si'],
    'teknologi informasi': ['teknologi informasi', 'ti'],
    'bisnis digital': ['bisnis digital', 'bd'],
    'sistem komputer': ['sistem komputer', 'sk'],
    'manajemen informatika': ['manajemen informatika', 'mi']
  };
  const terms = aliases[entity] || [entity];
  return terms.some((term) => value.includes(normalizeForAlignment(term)));
}

function detectAnswerQueryMismatch(answer, userQuery = '') {
  const queryTerms = getContentTerms(userQuery);
  const answerNorm = normalizeForAlignment(answer);
  const queryNorm = normalizeForAlignment(userQuery);
  const requestedEntities = detectRequiredEntities(userQuery);
  const missingEntities = requestedEntities.filter((entity) => !answerMentionsEntity(answer, entity));
  if (missingEntities.length) {
    return { mismatch: true, reason: 'missing_requested_entity', missingEntities, queryTerms };
  }

  const isVeryShortOrVague = queryNorm.length > 0 && queryTerms.length === 0 && queryNorm.split(/\s+/).filter(Boolean).length <= 3;
  if (isVeryShortOrVague && answerNorm.length > 80 && !/\b(?:halo|terima kasih|sama sama|baik)\b/i.test(answerNorm)) {
    return { mismatch: true, reason: 'ambiguous_short_query', missingEntities: [], queryTerms };
  }

  if (queryTerms.length >= 2) {
    const hits = queryTerms.filter((term) => answerNorm.includes(term));
    const hasIntentOverlap = detectIntentConflict(answer, userQuery).conflict === false
      && hasAnyIntent(detectIntentSet(answer), Array.from(detectIntentSet(userQuery)));
    if (!hits.length && !hasIntentOverlap && !requestedEntities.length) {
      return { mismatch: true, reason: 'no_query_term_overlap', missingEntities: [], queryTerms };
    }
  }

  return { mismatch: false, reason: null, missingEntities: [], queryTerms };
}

function hasAnyIntent(intentSet, intents) {
  return intents.some((intent) => intentSet.has(intent));
}

function detectIntentConflict(answer, userQuery = '') {
  const requested = detectIntentSet(userQuery);
  const answered = detectIntentSet(answer);
  if (!requested.size || !answered.size) {
    return { conflict: false, requested: Array.from(requested), answered: Array.from(answered) };
  }

  const compatible = new Map([
    ['scholarship', ['fee']],
    ['fee', ['scholarship']],
    ['double_degree', ['program', 'facility']],
    ['program', ['double_degree', 'career']],
    ['facility', ['ukm']]
  ]);

  for (const intent of requested) {
    const accepted = new Set([intent, ...(compatible.get(intent) || [])]);
    if (Array.from(accepted).some((item) => answered.has(item))) continue;
    if (intent === 'schedule' && requested.has('facility') && answered.has('facility')) continue;
    if (intent === 'registration' && requested.has('facility') && answered.has('facility')) continue;
    const offTopic = OFF_TOPIC_INTENTS[intent] || [];
    if (hasAnyIntent(answered, offTopic)) {
      return {
        conflict: true,
        requested: Array.from(requested),
        answered: Array.from(answered),
        missingIntent: intent
      };
    }
  }

  return { conflict: false, requested: Array.from(requested), answered: Array.from(answered) };
}
function extractFallbackTopicLabel(userQuery) {
  const q = String(userQuery || '').toLowerCase();
  if (!q.trim()) return '';
  const topics = [
    { label: 'BCCP', re: /\bbccp\b/i },
    { label: 'GCCP', re: /\bgccp\b/i },
    { label: 'program LinkedIn di Career Center', re: /\blinked\s*in|linkedin\b/i },
    { label: 'program Hi-Think', re: /\bhi-?think|hithink\b/i },
    { label: 'Inkubator Bisnis', re: /\binbis|inkubator\s+bisnis\b/i },
    { label: 'Career Center', re: /\bcareer\s*center|pusat\s+karier|pusat\s+karir\b/i },
    { label: 'pengembangan softskill', re: /\bsoftskill|pengembangan\s+soft\s*skill\b/i },
    { label: 'fasilitas belajar bahasa atau Language Learning Center', re: /\bbahasa|belajar\s+bahasa|kemampuan\s+bahasa|language\s+learning\s+center|llc\b/i },
    { label: 'UKM atau Ormawa', re: /\bukm(?:nya)?|ormawa|organisasi\s+mahasiswa|unit\s+kegiatan|esport|esports|musik|futsal|basket|teater|vos\b/i },
    { label: 'rincian biaya kuliah', re: /\bbiaya|harga|tarif|ukt|dpp|uang|bayar|pembayaran|cicilan|nominal\b/i },
    { label: 'jadwal pendaftaran PMB', re: /\bjadwal|kapan|tanggal|periode|gelombang|masih\s+dibuka|pendaftaran\s+sekarang|bulan\s+(?:ini|depan)\b/i },
    { label: 'beasiswa atau potongan biaya', re: /\bbeasiswa|kip|1k1s|bantuan\s+biaya|potongan|diskon|prestasi\b/i },
    { label: 'pendaftaran mahasiswa baru', re: /\bcara\s+daftar|mendaftar|registrasi|pendaftaran\s+online|syarat\s+(?:daftar|pendaftaran)|pmb|mahasiswa\s+baru|camaba\b/i },
    { label: 'kebijakan akademik', re: /\bremedial|remidi|absensi|presensi|kehadiran|ujian\s+susulan|ujian\s+ulang|dispensasi|izin\b/i },
    { label: 'program Double Degree', re: /\bdouble\s*degree|dual\s*degree|gelar\s+ganda|utb|dnui|help\s+university\b/i },
    { label: 'program studi atau jurusan', re: /\bprodi|program\s+studi|jurusan|sistem\s+informasi|teknologi\s+informasi|bisnis\s+digital|sistem\s+komputer\b/i },
    { label: 'fasilitas kampus', re: /\bfasilitas|layanan|sarana|prasarana|parkir|kantin|perpustakaan|wifi|laboratorium|ruang\s+kelas\b/i }
  ];
  const found = topics.find((item) => item.re.test(q));
  if (found) return found.label;
  const named = String(userQuery || '').match(/\b(?:program|fasilitas|layanan|ukm)\s+([A-Za-z0-9][A-Za-z0-9 ._-]{2,50}?)(?:\s+(?:itu|ini|apa|bagaimana|gimana|ya|kak|min|admin)|[?.!,]|$)/i);
  return named && named[0] ? named[0].replace(/[?.!,]+$/g, '').trim() : '';
}

function buildGenericPreflightFallback(userQuery, reason) {
  const topic = extractFallbackTopicLabel(userQuery);
  if (!topic) return '';
  if (reason === 'intent_conflict') {
    return 'Mohon maaf, jawaban yang terbentuk belum sesuai dengan pertanyaan kakak tentang ' + topic + ', jadi saya tahan agar tidak mengirim informasi yang keliru. Boleh kirim ulang pertanyaannya dengan topik yang lebih spesifik?';
  }
  return 'Untuk ' + topic + ', data yang saya pegang belum cukup lengkap atau belum cukup aman untuk menjawab detailnya. Jadi saya tidak akan menebak di luar informasi yang tersedia. Untuk detail resminya, kakak bisa konfirmasi ke admin kampus/PMB terkait.';
}
function buildPreflightFallback(userQuery, reason) {
  if (isConversationalQuery(userQuery)) return buildConversationalFallback(userQuery);
  const topicFallback = buildGenericPreflightFallback(userQuery, reason);
  if (topicFallback) return topicFallback;
  return 'Mohon maaf, saya belum mempunyai jawaban yang cukup aman dan lengkap untuk pertanyaan itu berdasarkan data yang tersedia.';
}

function hasExcessiveRawQuotation(answer) {
  const text = String(answer || '');
  const longLines = text.split(/\n+/).filter((line) => line.trim().length > 220).length;
  const quotedLines = text.split(/\n+/).filter((line) => /^\s*(?:>|"|\uFFFD|')/.test(line.trim())).length;
  return longLines >= 2 || quotedLines >= 3;
}

function hasPlaceholderOrOcrNoise(answer) {
  const text = String(answer || '');
  return /_{4,}|\.{6,}|:{3,}|\uFFFD{2,}|\b(?:left|right)\s+-?\d{3,}\b|\blogo\s+mitra\b|\(\s*nama\s+mitra\s*\)/i.test(text);
}

function isTooLongForQuestion(answer, userQuery) {
  const qWords = String(userQuery || '').trim().split(/\s+/).filter(Boolean).length;
  const answerLen = String(answer || '').length;
  if (qWords <= 3 && answerLen > 650) return true;
  if (qWords <= 8 && answerLen > 1800) return true;
  return false;
}

function lacksConcreteItemsForApaSaja(answer, userQuery) {
  if (!/\bapa\s+saja\b/i.test(String(userQuery || ''))) return false;
  const text = String(answer || '');
  const bulletCount = (text.match(/(?:^|\n)\s*(?:[-*\uFFFD]|\d+\.)\s+\S/g) || []).length;
  const namedItems = (text.match(/\b(?:GCCP|BCCP|Double\s*Degree|Dual\s*Degree|Student\s+Exchange|UTB|DNUI|HELP|KIP|Prestasi|Sistem\s+Informasi|Teknologi\s+Informasi|Bisnis\s+Digital|Sistem\s+Komputer)\b/gi) || []).length;
  const hasListLanguage = /\b(?:antara\s+lain|meliputi|terdiri\s+dari|tersedia|pilihan|program\s+mitra|beasiswa|program)\b/i.test(text);
  return bulletCount < 2 && namedItems < 2 && !hasListLanguage;
}

function isTrustedSemanticAlignmentSource(source) {
  const value = String(source || '').trim().toLowerCase();
  if (!value) return false;
  const trustedSemanticPrefix = /^semantic-rag-(?:uploaded-training|registration|pmb|current|program|fee|scholarship|rpl|academic|finance|student|international|lecturer|administration|career|campus|ukm|dual|linkedin|institution|operational|accreditation|akreditasi|small-talk|out-of-domain|unsupported|clarification)/i;
  const trustedProviderSource = /(?:^|[-_])(double_degree_process|fast_fee|fee_breakdown_offer_answer_fast|followup_compute_total|study_mode|dkv_available|fee_breakdown_offer_need_program|fee_breakdown_offer_answer|general_small_talk|greeting|permission_to_ask|pmb_info|provider_outbound)(?:$|[-_])/i;
  return trustedSemanticPrefix.test(value) || trustedProviderSource.test(value);
}

function isClarificationPromptAnswer(text) {
  const value = String(text || '').toLowerCase();
  if (!value.trim()) return false;
  return /\b(maksud(?:nya)?\s+(?:topik|yang)|topik\s+apa|sebutkan\s+dulu|mohon\s+sebutkan|bisa\s+sebutkan|perlu\s+konteks|butuh\s+konteks|pertanyaan\s+itu\s+masih\s+butuh\s+konteks)\b/i.test(value);
}
function decidePreflightAction(issues, meta = {}) {
  const hardIssues = new Set([
    'technical_leak',
    'raw_document_leak',
    'empty_answer',
    'intent_conflict',
    'missing_requested_entity',
    'ambiguous_short_query',
    'no_query_term_overlap',
    'placeholder_or_ocr_noise',
    'answer_query_mismatch',
    'apa_saja_without_concrete_items'
  ]);
  if (issues.some((issue) => hardIssues.has(issue))) {
    const regenerationCount = Number(meta.regenerationCount || meta.regenCount || 0);
    return regenerationCount < 2 ? 'regenerate' : 'fallback';
  }
  if (issues.includes('excessive_raw_quotation') || issues.includes('too_long_for_query') || issues.includes('long_answer_split_expected')) {
    return 'compress';
  }
  return 'send';
}
function evaluateOutboundAnswer(answer, userQuery = '', meta = {}) {
  const original = String(answer || '');

  // Add detailed logging for debugging preflight decisions
  if (process.env.PREFLIGHT_DEBUG_DETAILED) {
    console.log('[PREFLIGHT] Starting evaluation:', {
      questionLength: userQuery.length,
      answerLength: original.length,
      source: meta && meta.source ? meta.source : 'unknown'
    });
  }

  const rawFaqQnaDump = hasRawFaqQnaDump(original);
  let text = normalizeOutboundAnswerText(stripOptionalFollowupSuggestions(original));
  const issues = [];
  const conversationalQuery = isConversationalQuery(userQuery);

  if (!text.trim()) {
    text = buildPreflightFallback(userQuery, 'empty_answer');
    issues.push(conversationalQuery ? 'recovered_empty_conversation' : 'empty_answer');
  }

  if (conversationalQuery && isGenericRecoveryFallbackText(text)) {
    text = buildConversationalFallback(userQuery);
    issues.push('recovered_conversation_fallback');
  }

  const sourceValue = meta && meta.source ? String(meta.source).trim().toLowerCase() : '';
  const sensitiveAudit = detectSensitiveInformation(text);
  const businessRuleAudit = validateBusinessRules(text, userQuery);
  const citationAudit = validateCitation(text, meta || {});
  if (sensitiveAudit.hasSensitiveInfo && sensitiveAudit.hits.some((hit) => hit === 'secret_or_token')) {
    text = maskPii(text);
    issues.push('sensitive_secret_masked');
  }
  if (!businessRuleAudit.ok) {
    issues.push(...businessRuleAudit.issues.map((issue) => 'business_rule_' + issue));
  }
  const preserveTrustedFeeAnswer = (
    (/^semantic-rag-(?:fee|contextual-fee|registration-fee)/i.test(sourceValue) || /(?:^|[-_])(fast_fee|fee_breakdown_offer_answer_fast|fee_breakdown_offer_answer|followup_compute_total)(?:$|[-_])/i.test(sourceValue))
    || (/\bRp\.?\s*\d/i.test(text) && /\b(biaya|pendaftaran|dpp|ukt|semester|potongan|total|cicilan)\b/i.test(text))
  )
    && /\bRp\.?\s*\d/i.test(text)
    && /\b(biaya|pendaftaran|dpp|ukt|semester|potongan|total|cicilan)\b/i.test(text);
  const preserveTrustedDualDegreeAnswer = (
    /(?:^|[-_])(double_degree_process|study_mode|dkv_available)(?:$|[-_])/i.test(sourceValue)
    || (/\b(perkuliahan|kuliah|senin|jumat|bali|cina|online|tahun\s+ke-3|tahun\s+ke-4)\b/i.test(text) && /\b(double degree|dual degree|dnui|help)\b/i.test(String(userQuery || '')))
  )
    && /\b(perkuliahan|kuliah|senin|jumat|bali|cina|online|tahun\s+ke-3|tahun\s+ke-4)\b/i.test(text);
  const preserveTrustedInkubatorAnswer = sourceValue === 'semantic-rag-campus-support-entity'
    && /^Ya, ITB STIKOM Bali memiliki Inkubator Bisnis\b/i.test(text)
    && /\b(Pendampingan|Program inkubasi|mentoring|kewirausahaan|coworking|model bisnis|rintisan bisnis)\b/i.test(text)
    && !/\b(?:PROFIL\s+LEMBAGA|\[Sheet:|SOURCE_CHUNKS|CONFIDENCE|embedding|Identitas\s+Lembaga|Dasar\s+Hukum|Pembina\s*\/\s*Penanggung\s+Jawab|Struktur\s+Organisasi|DAFTAR\s+ISI)\b/i.test(text);
  if (
    !sensitiveAudit.hits.includes('secret_or_token') &&
    (preserveTrustedFeeAnswer || preserveTrustedDualDegreeAnswer || preserveTrustedInkubatorAnswer) &&
    !rawFaqQnaDump &&
    !hasRawTechnicalLeak(text) &&
    !hasDocumentSourceLeak(text)
  ) {
    return {
      answer: text,
      changed: text !== original,
      issues,
      action: 'send',
      blocked: false,
      meta: {
        source: meta && meta.source ? meta.source : null,
        originalLength: original.length,
        finalLength: text.length,
        trustedFeeBypass: preserveTrustedFeeAnswer,
        trustedDualDegreeBypass: preserveTrustedDualDegreeAnswer,
        trustedInkubatorBypass: preserveTrustedInkubatorAnswer,
        sensitiveInformation: sensitiveAudit,
        businessRuleValidation: businessRuleAudit,
        citationValidation: citationAudit,
        confidence: estimateFinalConfidence({
          retrievalScore: meta && meta.confidenceScore,
          intentConfidence: meta && meta.intentConfidence,
          safetyIssues: issues,
          answerable: true
        })
      }
    };
  }
  if (!issues.length && rawFaqQnaDump) {
    const recovered = recoverSafeSummaryFromLeakyAnswer(text, userQuery);
    if (recovered) {
      text = recovered;
      issues.push('recovered_raw_document_leak');
    } else {
      text = buildPreflightFallback(userQuery, 'raw_document_leak');
      issues.push(conversationalQuery ? 'recovered_conversation_document_leak' : 'raw_document_leak');
    }
  }

  if (!issues.length) {
    if (hasRawTechnicalLeak(text)) {
      if (process.env.PREFLIGHT_DEBUG_DETAILED) console.log('[PREFLIGHT] BLOCKED by hasRawTechnicalLeak');
      text = buildPreflightFallback(userQuery, 'technical_leak');
      issues.push(conversationalQuery ? 'recovered_conversation_technical_leak' : 'technical_leak');
    } else if (hasDocumentSourceLeak(text)) {
      if (process.env.PREFLIGHT_DEBUG_DETAILED) console.log('[PREFLIGHT] BLOCKED by hasDocumentSourceLeak');
      const recovered = recoverSafeSummaryFromLeakyAnswer(text, userQuery);
      if (recovered) {
        text = recovered;
        issues.push('recovered_raw_document_leak');
      } else {
        text = buildPreflightFallback(userQuery, 'raw_document_leak');
        issues.push(conversationalQuery ? 'recovered_conversation_document_leak' : 'raw_document_leak');
      }
    } else if (hasUnsafeAdministrativeLeak(text, userQuery) || hasLikelyRawDocumentLeak(text)) {
      if (process.env.PREFLIGHT_DEBUG_DETAILED) {
        console.log('[PREFLIGHT] BLOCKED by hasUnsafeAdministrativeLeak or hasLikelyRawDocumentLeak');
      }
      const recovered = recoverSafeSummaryFromLeakyAnswer(text, userQuery);
      if (recovered) {
        text = recovered;
        issues.push('recovered_raw_document_leak');
      } else {
        text = buildPreflightFallback(userQuery, 'raw_document_leak');
        issues.push(conversationalQuery ? 'recovered_conversation_document_leak' : 'raw_document_leak');
      }
    } else if (hasPlaceholderOrOcrNoise(text)) {
      if (process.env.PREFLIGHT_DEBUG_DETAILED) console.log('[PREFLIGHT] BLOCKED by hasPlaceholderOrOcrNoise');
      issues.push('placeholder_or_ocr_noise');
      text = buildPreflightFallback(userQuery, 'raw_document_leak');
    } else if (lacksConcreteItemsForApaSaja(text, userQuery)) {
      if (process.env.PREFLIGHT_DEBUG_DETAILED) console.log('[PREFLIGHT] BLOCKED by lacksConcreteItemsForApaSaja');
      issues.push('apa_saja_without_concrete_items');
      text = buildPreflightFallback(userQuery, 'intent_conflict');
    } else if (conversationalQuery) {
      // Greetings and simple social replies do not need RAG alignment checks.
    } else if (!isTrustedSemanticAlignmentSource(meta && meta.source)) {
      const alignmentAudit = detectAnswerQueryMismatch(text, userQuery);
      if (alignmentAudit.mismatch) {
        if (alignmentAudit.reason === 'ambiguous_short_query' && isClarificationPromptAnswer(text)) {
          // Clarification prompts are the correct response for very short ambiguous queries.
        } else {
          if (process.env.PREFLIGHT_DEBUG_DETAILED) {
            console.log('[PREFLIGHT] BLOCKED by alignment mismatch:', alignmentAudit.reason);
            try {
              console.log('[PREFLIGHT] ALIGNMENT_AUDIT_DETAIL', {
                reason: alignmentAudit.reason,
                queryTerms: alignmentAudit.queryTerms,
                requestedIntents: Array.from(detectIntentSet(userQuery || '')),
                answeredIntents: Array.from(detectIntentSet(text || '')),
                questionPreview: String(userQuery || '').slice(0, 200),
                answerPreview: String(text || '').slice(0, 200)
              });
            } catch (e) { }
          }
          issues.push(alignmentAudit.reason || 'answer_query_mismatch');
          text = buildPreflightFallback(userQuery, 'intent_conflict');
        }
      } else {
        const intentAudit = detectIntentConflict(text, userQuery);
        if (intentAudit.conflict) {
          if (process.env.PREFLIGHT_DEBUG_DETAILED) {
            console.log('[PREFLIGHT] BLOCKED by intent conflict:', intentAudit);
            try {
              console.log('[PREFLIGHT] INTENT_AUDIT_DETAIL', {
                requestedIntents: Array.from(detectIntentSet(userQuery || '')),
                answeredIntents: Array.from(detectIntentSet(text || '')),
                missingIntent: intentAudit.missingIntent || null,
                questionPreview: String(userQuery || '').slice(0, 200),
                answerPreview: String(text || '').slice(0, 200)
              });
            } catch (e) { }
          }
          issues.push('intent_conflict');
          text = buildPreflightFallback(userQuery, 'intent_conflict');
        }
      }
    }
  }

  // Log final decision if debugging
  if (process.env.PREFLIGHT_DEBUG_DETAILED) {
    const action = decidePreflightAction(issues, meta);
    const blocked = action === 'regenerate' || action === 'fallback';
    console.log('[PREFLIGHT] Final decision:', {
      blocked,
      action,
      issues,
      answerLength: text.length
    });
  }

  if (/\b(?:\w{2,})(?:\u2026|\.\.\.)\s*$/i.test(text)) {
    issues.push('dangling_ellipsis');
    text = normalizeOutboundAnswerText(text);
  }

  const maxSoftLen = parseInt(process.env.BOT_PREFLIGHT_SOFT_MAX_CHARS || '3200', 10);
  if (Number.isFinite(maxSoftLen) && maxSoftLen > 0 && text.length > maxSoftLen) issues.push('long_answer_split_expected');
  if (hasExcessiveRawQuotation(original)) issues.push('excessive_raw_quotation');
  if (isTooLongForQuestion(original, userQuery)) issues.push('too_long_for_query');

  if (issues.includes('ambiguous_short_query') && isClarificationPromptAnswer(text)) {
    for (let i = issues.length - 1; i >= 0; i -= 1) {
      if (issues[i] === 'ambiguous_short_query') issues.splice(i, 1);
    }
  }
  const action = decidePreflightAction(issues, meta);
  const blocked = action === 'regenerate' || action === 'fallback';
  const finalConfidence = estimateFinalConfidence({
    retrievalScore: meta && meta.confidenceScore,
    intentConfidence: meta && meta.intentConfidence,
    safetyIssues: issues,
    answerable: !blocked
  });

  // ISSUE #1 FIX: Log final preflight decision for debugging
  if (process.env.PREFLIGHT_DEBUG_DETAILED) {
    console.log('[PREFLIGHT] Final decision:', {
      blocked,
      action,
      issues,
      finalAnswerLength: text.length,
      originalAnswerLength: original.length
    });
  }

  return {
    answer: text,
    changed: text !== original,
    issues,
    action,
    blocked,
    meta: {
      source: meta && meta.source ? meta.source : null,
      originalLength: original.length,
      finalLength: text.length,
      sensitiveInformation: sensitiveAudit,
      businessRuleValidation: businessRuleAudit,
      citationValidation: citationAudit,
      confidence: finalConfidence
    }
  };
}
module.exports = {
  evaluateOutboundAnswer,
  normalizeOutboundAnswerText,
  stripOptionalFollowupSuggestions,
  hasRawTechnicalLeak,
  hasDocumentSourceLeak,
  hasLikelyRawDocumentLeak,
  isConversationalQuery,
  detectIntentConflict,
  detectAnswerQueryMismatch
};
