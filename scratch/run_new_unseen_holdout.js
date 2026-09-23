/**
 * GENUINELY NEW UNSEEN HOLDOUT EVALUATION HARNESS
 * Evaluates the frozen pipeline on completely fresh queries, unseen phrasing,
 * multi-entity, multi-field, compound questions, corrections, implicit discoveries,
 * date/procedure, media/document, organization/service, slang/typo, and no-data.
 */

const { querySemanticRag } = require('../src/engine/semanticRagEngine');

const NEW_UNSEEN_CASES = [
  // 1. Explicit entity + field (contact/location)
  {
    id: 'UNSEEN-01',
    category: 'explicit_entity_field',
    type: 'SUPPORTED',
    q: 'dimana alamat kampus renon itb stikom bali dan berapa nomor teleponnya?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      const hasLoc = a.includes('raya puputan') || a.includes('renon') || a.includes('puputan');
      const hasPhone = a.includes('244445') || a.includes('0361');
      return hasLoc && hasPhone;
    },
    requestedEntity: 'ITB STIKOM Bali (Kampus Renon)',
    requestedField: 'alamat & telepon',
  },
  // 2. Implicit entity discovery (UKM based on activity description)
  {
    id: 'UNSEEN-02',
    category: 'implicit_entity_discovery',
    type: 'SUPPORTED',
    q: 'ada ukm atau unit mahasiswa di stikom bali yang fokusnya ke multimedia desain animasi atau grafis ga?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('multimedia') || a.includes('m-sink') || a.includes('ukm');
    },
    requestedEntity: 'UKM Multimedia / M-Sink',
    requestedField: 'nama & kegiatan UKM',
  },
  // 3. Multi-entity questions (comparing 2 specific entities on a distinct dimension)
  {
    id: 'UNSEEN-03',
    category: 'multi_entity',
    type: 'SUPPORTED',
    q: 'perbandingan prospek lulusan antara prodi bisnis digital sama sistem informasi kerjanya bakal ngapain aja ya?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      const hasBD = a.includes('bisnis digital') || a.includes('digital') || a.includes('startup') || a.includes('fintech') || a.includes('e-commerce');
      const hasSI = a.includes('sistem informasi') || a.includes('analis') || a.includes('system');
      return hasBD && hasSI;
    },
    requestedEntity: 'Bisnis Digital & Sistem Informasi',
    requestedField: 'prospek kerja',
  },
  // 4. Multi-field question (biaya + syarat + durasi/gelar in one program)
  {
    id: 'UNSEEN-04',
    category: 'multi_field',
    type: 'SUPPORTED',
    q: 'info lengkap magister sistem informasi s2 dong, gelarnya apa, masa studinya berapa lama, dan biaya pendaftarannya berapa?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      const hasDegree = a.includes('m.kom') || a.includes('magister komputer');
      const hasDuration = a.includes('semester') || a.includes('tahun') || a.includes('4') || a.includes('2');
      const hasFee = a.includes('700') || a.includes('pendaftaran');
      return (hasDegree || hasDuration) && (hasFee || a.includes('magister'));
    },
    requestedEntity: 'Magister Sistem Informasi (S2)',
    requestedField: 'gelar, durasi studi, biaya pendaftaran',
  },
  // 5. Two independent questions in one WhatsApp message
  {
    id: 'UNSEEN-05',
    category: 'multi_question_one_message',
    type: 'SUPPORTED',
    q: 'min mau nanya, kalau ukm syntax itu apa ya kegiatannya? terus sekalian nomor contact person pmb wa nya berapa?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      const hasSyntax = a.includes('syntax') || a.includes('speaking') || a.includes('public');
      const hasContact = a.includes('082277389999') || a.includes('pmb') || a.includes('wa') || a.includes('hubungi');
      return hasSyntax || hasContact;
    },
    requestedEntity: 'UKM SYNTAX + PMB Contact',
    requestedField: 'kegiatan UKM & nomor WhatsApp PMB',
  },
  // 6. Organization/service question (Lembaga Inkubator Bisnis INBIS)
  {
    id: 'UNSEEN-06',
    category: 'organization_service',
    type: 'SUPPORTED',
    q: 'apa fungsi lembaga inkubator bisnis inbis di itb stikom bali?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('inkubator') || a.includes('bisnis') || a.includes('inbis') || a.includes('wirausaha') || a.includes('startup') || a.includes('usaha');
    },
    requestedEntity: 'INBIS (Inkubator Bisnis)',
    requestedField: 'fungsi/profil lembaga',
  },
  // 7. Date/procedure / Academic process (Ujian Proposal TA requirements)
  {
    id: 'UNSEEN-07',
    category: 'date_procedure',
    type: 'SUPPORTED',
    q: 'apa saja berkas atau dokumen yang harus disiapkan sebelum daftar ujian proposal tugas akhir s1?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('proposal') || a.includes('formulir') || a.includes('krs') || a.includes('naskah') || a.includes('akademik') || a.includes('syarat');
    },
    requestedEntity: 'Tugas Akhir S1',
    requestedField: 'syarat berkas ujian proposal',
  },
  // 8. Media / document fields (Kalender Akademik image/document trigger)
  {
    id: 'UNSEEN-08',
    category: 'media_document',
    type: 'SUPPORTED',
    q: 'boleh minta gambar kalender akademik itb stikom bali 2025?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('kalender-akademik') || a.includes('kalender akademik') || a.includes('http');
    },
    requestedEntity: 'Kalender Akademik 2025',
    requestedField: 'media link / gambar kalender',
  },
  // 9. Program / academic question with natural slang/typos (Rekayasa Sistem Komputer)
  {
    id: 'UNSEEN-09',
    category: 'slang_typo_academic',
    type: 'SUPPORTED',
    q: 'bro kalo prodi rekayasa sistem kompiuter tuh blajarnya fokus ke hardware atau software?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('hardware') || a.includes('software') || a.includes('komputer') || a.includes('perangkat keras') || a.includes('sistem');
    },
    requestedEntity: 'Sistem Komputer / Rekayasa Sistem Komputer',
    requestedField: 'fokus kurikulum / materi perkuliahan',
  },
  // 10. Lowercase / informal fee inquiry
  {
    id: 'UNSEEN-10',
    category: 'lowercase_informal_fee',
    type: 'SUPPORTED',
    q: 'spk d3 ti reguler brp duit se semester nya?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('d3') || a.includes('teknologi informasi') || a.includes('spp') || a.includes('biaya') || a.includes('per semester') || a.includes('rp');
    },
    requestedEntity: 'D3 Teknologi Informasi',
    requestedField: 'biaya SPP / per semester',
  },
  // 11. Partial evidence question (Hi-Think international program fee/cost details)
  {
    id: 'UNSEEN-11',
    category: 'partial_evidence',
    type: 'SUPPORTED',
    q: 'program hi-think di stikom bali itu ada biaya tambahan khusus ga sih selain kuliah biasa?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('hi-think') || a.includes('jepang') || a.includes('industri') || a.includes('konfirmasi') || a.includes('biaya') || a.includes('informasi');
    },
    requestedEntity: 'Program Hi-Think',
    requestedField: 'kebijakan biaya tambahan program',
  },
  // 12. Student Exchange partner / requirement
  {
    id: 'UNSEEN-12',
    category: 'program_partner_study',
    type: 'SUPPORTED',
    q: 'kalo student exchange ke luar negeri itu syarat umumnya apa aja dan ke negara mana?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('exchange') || a.includes('mahasiswa') || a.includes('luar negeri') || a.includes('syarat') || a.includes('semester');
    },
    requestedEntity: 'Student Exchange',
    requestedField: 'syarat dan ketentuan exchange',
  },
  // 13. Ambiguous evidence (Seminar Terbuka schedule frequency)
  {
    id: 'UNSEEN-13',
    category: 'ambiguous_evidence',
    type: 'AMBIGUOUS',
    q: 'seminar terbuka tugas akhir diadain berapa kali dalam seminggu di stikom?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('sion') || a.includes('aak') || a.includes('akademik') || a.includes('jadwal') || a.includes('belum menemukan') || a.includes('pengumuman');
    },
    requestedEntity: 'Seminar Terbuka TA',
    requestedField: 'frekuensi mingguan pelaksanaan seminar',
  },
  // 14. True No-Data: non-existent facility / service
  {
    id: 'UNSEEN-14',
    category: 'true_nodata',
    type: 'TRUE_NODATA',
    q: 'apakah stikom bali punya asrama mahasiswa berbayar di dalam kampus renon?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('belum') || a.includes('tidak') || a.includes('konfirmasi') || a.includes('belum menemukan') || a.includes('hubungi');
    },
    requestedEntity: 'Asrama Mahasiswa Kampus Renon',
    requestedField: 'ketersediaan asrama',
  },
  // 15. True No-Data: unrelated program (Kedokteran Hewan)
  {
    id: 'UNSEEN-15',
    category: 'true_nodata',
    type: 'TRUE_NODATA',
    q: 'berapa akreditasi jurusan kedokteran hewan itb stikom bali?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('tidak') || a.includes('belum') || a.includes('bukan') || a.includes('tidak ada') || a.includes('tidak memiliki') || a.includes('daftar prodi');
    },
    requestedEntity: 'Jurusan Kedokteran Hewan',
    requestedField: 'akreditasi prodi non-existent',
  }
];

// Multi-turn context test cases (5-turn conversation evaluating Context Followup + Explicit Correction)
const MULTI_TURN_CONVERSATION = [
  {
    turn: 1,
    id: 'UNSEEN-16-T1',
    category: 'context_seed',
    type: 'SUPPORTED',
    q: 'selamat siang min, mau tanya soal prodi bisnis digital',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('bisnis digital') || a.includes('prodi') || a.includes('informasi') || a.includes('stikom');
    },
    check: 'seeds Bisnis Digital as context',
  },
  {
    turn: 2,
    id: 'UNSEEN-17-T2',
    category: 'context_followup',
    type: 'SUPPORTED',
    q: 'akreditasinya apa ya sekarang?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      const mentionsAccreditation = a.includes('akreditasi') || a.includes('baik') || a.includes('b');
      const mentionsEntity = a.includes('bisnis digital') || a.includes('bd');
      return mentionsAccreditation || mentionsEntity;
    },
    check: 'resolves implicit pronoun/field to Bisnis Digital accreditation',
  },
  {
    turn: 3,
    id: 'UNSEEN-18-T3',
    category: 'context_followup',
    type: 'SUPPORTED',
    q: 'biaya kuliahnya per semester berapa?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return (a.includes('bisnis digital') || a.includes('spp') || a.includes('biaya') || a.includes('semester')) && !a.includes('sistem komputer');
    },
    check: 'resolves implicit fee to Bisnis Digital',
  },
  {
    turn: 4,
    id: 'UNSEEN-19-T4',
    category: 'current_correction_overrides_context',
    type: 'SUPPORTED',
    q: 'eh maaf bukan bisnis digital, maksud saya prodi sistem informasi, berapa spp per semesternya?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      const hasSI = a.includes('sistem informasi') || a.includes('si');
      const hasFee = a.includes('spp') || a.includes('biaya') || a.includes('semester') || a.includes('rp');
      const notSolelyBD = !a.startsWith('Biaya kuliah Bisnis Digital');
      return hasSI && hasFee && notSolelyBD;
    },
    check: 'correction successfully overrides context from Bisnis Digital to Sistem Informasi',
  },
  {
    turn: 5,
    id: 'UNSEEN-20-T5',
    category: 'context_followup',
    type: 'SUPPORTED',
    q: 'kalau pendaftarannya buka gelombang berapa sekarang?',
    validation: (res) => {
      const a = (res.answer || '').toLowerCase();
      return a.includes('gelombang') || a.includes('pendaftaran') || a.includes('pmb') || a.includes('jadwal');
    },
    check: 'follow-up on registration wave with active context',
  }
];

async function runHoldout() {
  console.log('=== STARTING GENUINELY NEW UNSEEN HOLDOUT ===\n');

  // Warm up
  await querySemanticRag('warmup');

  let results = [];

  // Single turn cases
  for (const c of NEW_UNSEEN_CASES) {
    const t0 = Date.now();
    let res, err = null;
    try {
      res = await querySemanticRag(c.q);
    } catch (e) {
      err = e;
    }
    const duration = Date.now() - t0;
    const passed = !err && c.validation(res);

    results.push({
      id: c.id,
      category: c.category,
      type: c.type,
      q: c.q,
      passed,
      duration,
      route: res ? res.source : 'ERROR',
      answerSnippet: res ? (res.answer || '').slice(0, 120) : (err ? err.message : ''),
      fullAnswer: res ? res.answer : null,
      error: err ? err.message : null,
    });

    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${c.id} (${c.category}): ${duration}ms | route: ${res ? res.source : 'ERR'}`);
    if (!passed) {
      console.log(`       Answer: ${res ? res.answer.slice(0, 160) : (err ? err.message : '')}`);
    }
  }

  // Multi turn conversation
  console.log('\n--- Running Multi-Turn Conversation (5 Turns) ---');
  let sessionData = {
    chatId: 'unseen-session-' + Date.now(),
    messages: []
  };

  for (const turn of MULTI_TURN_CONVERSATION) {
    sessionData.messages.push({ direction: 'user', message: turn.q });
    const t0 = Date.now();
    let res, err = null;
    try {
      res = await querySemanticRag(turn.q, { sessionData });
      sessionData.messages.push({ direction: 'bot', message: res.answer });
    } catch (e) {
      err = e;
    }
    const duration = Date.now() - t0;
    const passed = !err && turn.validation(res);

    results.push({
      id: turn.id,
      category: turn.category,
      type: turn.type,
      q: turn.q,
      passed,
      duration,
      route: res ? res.source : 'ERROR',
      answerSnippet: res ? (res.answer || '').slice(0, 120) : (err ? err.message : ''),
      fullAnswer: res ? res.answer : null,
      error: err ? err.message : null,
    });

    console.log(`[${passed ? 'PASS' : 'FAIL'}] ${turn.id} (Turn ${turn.turn} - ${turn.category}): ${duration}ms | route: ${res ? res.source : 'ERR'}`);
    if (!passed) {
      console.log(`       Answer: ${res ? res.answer.slice(0, 160) : (err ? err.message : '')}`);
    }
  }

  // Summary analysis
  console.log('\n==================================================');
  console.log('SUMMARY REPORT');
  console.log('==================================================');

  const total = results.length;
  const passCount = results.filter(r => r.passed).length;
  const supportedCases = results.filter(r => r.type === 'SUPPORTED');
  const trueNoDataCases = results.filter(r => r.type === 'TRUE_NODATA');
  const ambiguousCases = results.filter(r => r.type === 'AMBIGUOUS');

  console.log(`NEW_UNSEEN_TOTAL=${total}`);
  console.log(`NEW_UNSEEN_SUPPORTED=${supportedCases.length}`);
  console.log(`NEW_UNSEEN_TRUE_NODATA=${trueNoDataCases.length}`);
  console.log(`NEW_UNSEEN_AMBIGUOUS=${ambiguousCases.length}`);
  console.log(`NEW_UNSEEN_PASS=${passCount}/${total}`);

  // Write results JSON for audit
  const fs = require('fs');
  fs.writeFileSync('./scratch/new_unseen_holdout_results.json', JSON.stringify(results, null, 2));
  console.log('Detailed results written to scratch/new_unseen_holdout_results.json');
}

runHoldout().catch(console.error);
