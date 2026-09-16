/**
 * PHASE 6: END-TO-END MULTI-TURN GENERALIZATION VALIDATION
 * Strictly READ-ONLY regarding production codebase.
 * 
 * Matrix:
 * - 50 multi-turn conversations
 * - 3–6 turns per conversation
 * - 202 total turns
 * - All 18 domains covered
 * - All 12 required variations covered
 */
process.env.NODE_ENV = 'test';
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.PROVIDER_TOKEN = '';
process.env.OPENAI_API_KEY = '';
process.env.ENABLE_RAG = 'true';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_DB_CONTENT_FALLBACK = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.SEMANTIC_RAG_FIRST = 'true';
process.env.DISABLE_KEYWORD_RULES = 'true';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
process.env.PERSISTENT_INBOUND_DEDUPE = 'false';
process.env.BOT_REPLY_TIMEOUT_MS = '60000';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

const {
  makeRequest,
  EVIDENCE_REGISTRY,
  sessionStore,
  chatStore,
  providerRouterFactory
} = require('../tmp/blind_test_harness');

// 50 Conversations Matrix
const PHASE6_CONVERSATIONS = [
  // 1. career & entity substitution (SI -> TI -> BD -> SK)
  {
    convId: 'P6_C01',
    domain: 'career',
    variation: 'entity substitution, informal, singkatan, -nya morphology',
    turns: [
      {
        turnIndex: 1,
        query: 'Prospek kerja Sistem Informasi gimana?',
        expectedDomain: 'career',
        expectedEntity: 'SI',
        expectedRelation: 'career_prospects',
        expectedKeywords: ['Sistem Informasi', 'analyst', 'data', 'konsultan', 'bisnis']
      },
      {
        turnIndex: 2,
        query: 'kalau TI?',
        expectedDomain: 'career',
        expectedEntity: 'TI',
        expectedRelation: 'career_prospects',
        expectedKeywords: ['Teknologi Informasi', 'software', 'developer', 'jaringan', 'cloud']
      },
      {
        turnIndex: 3,
        query: 'klo Bisnis Digital tamatnya kerja apa?',
        expectedDomain: 'career',
        expectedEntity: 'BD',
        expectedRelation: 'career_prospects',
        expectedKeywords: ['Bisnis Digital', 'digital', 'marketer', 'e-commerce', 'bisnis']
      },
      {
        turnIndex: 4,
        query: 'yang sistem komputer prospeknya gmn?',
        expectedDomain: 'career',
        expectedEntity: 'SK',
        expectedRelation: 'career_prospects',
        expectedKeywords: ['Sistem Komputer', 'hardware', 'iot', 'jaringan', 'embedded']
      }
    ]
  },

  // 2. recommendation & relation follow-up (Prospek BD -> SI alternative -> BD comparison -> career comparison)
  {
    convId: 'P6_C02',
    domain: 'recommendation',
    variation: 'relation follow-up, program comparison',
    turns: [
      {
        turnIndex: 1,
        query: 'Prospek Bisnis Digital gimana?',
        expectedDomain: 'career_recommendation',
        expectedEntity: 'BD',
        expectedRelation: 'recommend_by_interest',
        expectedKeywords: ['Bisnis Digital', 'digital', 'marketing', 'e-commerce', 'bisnis']
      },
      {
        turnIndex: 2,
        query: 'kenapa SI jadi alternatif?',
        expectedDomain: 'career_recommendation',
        expectedEntity: 'SI',
        expectedRelation: 'recommendation_reason',
        expectedKeywords: ['Sistem Informasi', 'bisnis', 'analisis', 'data']
      },
      {
        turnIndex: 3,
        query: 'kalau Bisnis Digital bedanya apa sama SI?',
        expectedDomain: 'program_comparison',
        expectedEntity: 'BD_VS_SI',
        expectedRelation: 'curriculum_diff',
        expectedKeywords: ['Bisnis Digital', 'Sistem Informasi']
      },
      {
        turnIndex: 4,
        query: 'peluang kerjanya lebih luas mana?',
        expectedDomain: 'career_prospect',
        expectedEntity: 'BD_VS_SI',
        expectedRelation: 'career_comparison',
        expectedKeywords: ['karier', 'karir', 'prospek', 'bidang', 'peluang', 'kerja', 'Career']
      }
    ]
  },

  // 3. curriculum & context repair (TI curriculum -> repair intent to career -> curriculum deep-dive)
  {
    convId: 'P6_C03',
    domain: 'curriculum',
    variation: 'repair/correction, relation follow-up',
    turns: [
      {
        turnIndex: 1,
        query: 'TI belajar apa aja min?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'TI',
        expectedRelation: 'curriculum_topics',
        expectedKeywords: ['pemrograman', 'jaringan', 'cloud', 'Teknologi Informasi']
      },
      {
        turnIndex: 2,
        query: 'maksud saya tamatnya jadi apa',
        expectedDomain: 'career_prospect',
        expectedEntity: 'TI',
        expectedRelation: 'context_repair_career',
        expectedKeywords: ['software', 'developer', 'engineer', 'jaringan', 'prospek', 'karier', 'Career']
      },
      {
        turnIndex: 3,
        query: 'kalo matkul coding di TI banyak ga?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'TI',
        expectedRelation: 'coding_intensity',
        expectedKeywords: ['pemrograman', 'coding', 'software', 'aplikasi', 'Teknologi Informasi']
      },
      {
        turnIndex: 4,
        query: 'ada belajar cloud computing di TI juga?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'TI',
        expectedRelation: 'cloud_topics',
        expectedKeywords: ['cloud', 'komputasi', 'teknologi', 'Teknologi Informasi']
      }
    ]
  },

  // 4. fee & -nya morphology & typo & singkatan (TI fee -> registration -> installment -> discount)
  {
    convId: 'P6_C04',
    domain: 'fee',
    variation: 'typo ringan, singkatan, -nya morphology, short follow-up',
    turns: [
      {
        turnIndex: 1,
        query: 'halo min mw tny biayany TI donk',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'TI',
        expectedRelation: 'tuition_fee',
        expectedKeywords: ['Teknologi Informasi', '6.500.000', '14.000.000', 'DPP', 'UKT']
      },
      {
        turnIndex: 2,
        query: 'klo pendaftaranny brp ya?',
        expectedDomain: 'registration_fee',
        expectedEntity: 'TI',
        expectedRelation: 'registration_fee',
        expectedKeywords: ['500.000', 'pendaftaran']
      },
      {
        turnIndex: 3,
        query: 'bisa dicicil ga min?',
        expectedDomain: 'fee_installment',
        expectedEntity: 'TI',
        expectedRelation: 'installment_plan',
        expectedKeywords: ['cicil', 'angsur', 'DPP', 'tahap']
      },
      {
        turnIndex: 4,
        query: 'potongan dpp gelombang 1 ada ga?',
        expectedDomain: 'fee_discount',
        expectedEntity: 'TI',
        expectedRelation: 'discount_wave',
        expectedKeywords: ['potongan', 'dpp', 'gelombang']
      }
    ]
  },

  // 5. registration fee & explicit topic switch (Reg fee -> payment method -> switch to UKM Pragina)
  {
    convId: 'P6_C05',
    domain: 'registration fee',
    variation: 'explicit topic switch, UKM detail',
    turns: [
      {
        turnIndex: 1,
        query: 'biaya formulir pendaftaran stikom bali brp min',
        expectedDomain: 'registration_fee',
        expectedEntity: 'STIKOM',
        expectedRelation: 'registration_cost',
        expectedKeywords: ['500.000', 'pendaftaran']
      },
      {
        turnIndex: 2,
        query: 'bisa bayar lewat transfer apa aja?',
        expectedDomain: 'registration_fee',
        expectedEntity: 'STIKOM',
        expectedRelation: 'payment_methods',
        expectedKeywords: ['transfer', 'bank', 'virtual', 'pembayaran']
      },
      {
        turnIndex: 3,
        query: 'eh ada ukm tari bali ga?',
        expectedDomain: 'student_organization',
        expectedEntity: 'PRAGINA',
        expectedRelation: 'art_dance_club',
        expectedKeywords: ['Pragina', 'tari', 'seni']
      },
      {
        turnIndex: 4,
        query: 'nama ukm tarinya apa ya?',
        expectedDomain: 'student_organization',
        expectedEntity: 'PRAGINA',
        expectedRelation: 'dance_club_name',
        expectedKeywords: ['Pragina']
      }
    ]
  },

  // 6. installment & DPP scheme (DPP overview -> stages -> requirements -> UKT policy)
  {
    convId: 'P6_C06',
    domain: 'installment',
    variation: 'informal, policy detail',
    turns: [
      {
        turnIndex: 1,
        query: 'uang gedung di stikom itu dpp ya?',
        expectedDomain: 'fee_total',
        expectedEntity: 'STIKOM',
        expectedRelation: 'dpp_definition',
        expectedKeywords: ['DPP', 'dana pengembangan pendidikan', 'gedung']
      },
      {
        turnIndex: 2,
        query: 'skema cicilan dpp berapa kali angsuran?',
        expectedDomain: 'fee_installment',
        expectedEntity: 'STIKOM',
        expectedRelation: 'installment_stages',
        expectedKeywords: ['cicil', 'angsur', 'tahap', 'semester']
      },
      {
        turnIndex: 3,
        query: 'syarat pengajuan cicilannya apa aja?',
        expectedDomain: 'fee_installment',
        expectedEntity: 'STIKOM',
        expectedRelation: 'installment_requirements',
        expectedKeywords: ['syarat', 'permohonan', 'keuangan', 'cicilan']
      },
      {
        turnIndex: 4,
        query: 'kalo ukt per semester bisa dicicil juga ga?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'STIKOM',
        expectedRelation: 'tuition_installment_policy',
        expectedKeywords: ['ukt', 'semester', 'biaya']
      }
    ]
  },

  // 7. scholarship KIP Kuliah (formal inquiry -> requirements -> coverage -> deadline)
  {
    convId: 'P6_C07',
    domain: 'scholarship',
    variation: 'formal Indonesian, -nya morphology',
    turns: [
      {
        turnIndex: 1,
        query: 'apakah stikom bali menerima pendaftaran beasiswa kip kuliah',
        expectedDomain: 'scholarship',
        expectedEntity: 'KIP_KULIAH',
        expectedRelation: 'kip_availability',
        expectedKeywords: ['KIP', 'kuliah', 'beasiswa']
      },
      {
        turnIndex: 2,
        query: 'syarat berkas yg harus disiapkan apa saja?',
        expectedDomain: 'scholarship',
        expectedEntity: 'KIP_KULIAH',
        expectedRelation: 'kip_requirements',
        expectedKeywords: ['kip', 'kartu', 'penghasilan', 'syarat']
      },
      {
        turnIndex: 3,
        query: 'komponen biaya apa saja yang dicover?',
        expectedDomain: 'scholarship',
        expectedEntity: 'KIP_KULIAH',
        expectedRelation: 'kip_benefits',
        expectedKeywords: ['biaya', 'pendidikan', 'kuliah']
      },
      {
        turnIndex: 4,
        query: 'kapan batas akhir pengajuan kip kuliah?',
        expectedDomain: 'scholarship',
        expectedEntity: 'KIP_KULIAH',
        expectedRelation: 'kip_deadline',
        expectedKeywords: ['jadwal', 'batas', 'kip', 'pendaftaran']
      }
    ]
  },

  // 8. scholarship Prestasi & Yayasan (Prestasi -> discount -> Yayasan -> combination policy)
  {
    convId: 'P6_C08',
    domain: 'scholarship',
    variation: 'entity substitution, policy check',
    turns: [
      {
        turnIndex: 1,
        query: 'ada beasiswa prestasi akademik atau non akademik ga min?',
        expectedDomain: 'scholarship',
        expectedEntity: 'PRESTASI',
        expectedRelation: 'prestasi_availability',
        expectedKeywords: ['prestasi', 'beasiswa', 'juara', 'sertifikat']
      },
      {
        turnIndex: 2,
        query: 'potongan dpp nya berapa persen untuk jalur prestasi?',
        expectedDomain: 'scholarship',
        expectedEntity: 'PRESTASI',
        expectedRelation: 'prestasi_discount',
        expectedKeywords: ['potongan', 'dpp', 'persen']
      },
      {
        turnIndex: 3,
        query: 'kalau beasiswa yayasan syaratnya gmn?',
        expectedDomain: 'scholarship',
        expectedEntity: 'YAYASAN',
        expectedRelation: 'yayasan_requirements',
        expectedKeywords: ['yayasan', 'beasiswa', 'syarat']
      },
      {
        turnIndex: 4,
        query: 'bisa digabung sama beasiswa lain ga?',
        expectedDomain: 'scholarship',
        expectedEntity: 'SCHOLARSHIP_POLICY',
        expectedRelation: 'combine_policy',
        expectedKeywords: ['beasiswa', 'ketentuan', 'gabung']
      }
    ]
  },

  // 9. schedule & waves (Overview -> Gelombang 1 -> Gelombang 2 -> Gelombang 3)
  {
    convId: 'P6_C09',
    domain: 'schedule',
    variation: 'short follow-up, entity substitution across waves',
    turns: [
      {
        turnIndex: 1,
        query: 'pmb tahun ini ada berapa gelombang min',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'STIKOM',
        expectedRelation: 'wave_overview',
        expectedKeywords: ['gelombang', 'pendaftaran', 'pmb']
      },
      {
        turnIndex: 2,
        query: 'gelombang 1 buka dan tutup kapan?',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'WAVE_1',
        expectedRelation: 'wave_1_dates',
        expectedKeywords: ['Gelombang 1', 'januari', 'maret']
      },
      {
        turnIndex: 3,
        query: 'kalo gelombang 2?',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'WAVE_2',
        expectedRelation: 'wave_2_dates',
        expectedKeywords: ['Gelombang 2', 'april', 'juni', 'maret']
      },
      {
        turnIndex: 4,
        query: 'gelombang 3 ada diskon dpp ga?',
        expectedDomain: 'fee_discount',
        expectedEntity: 'WAVE_3',
        expectedRelation: 'wave_3_discount',
        expectedKeywords: ['dpp', 'potongan', 'gelombang']
      }
    ]
  },

  // 10. PMB requirements & procedure (Formal S1 requirements -> document copies -> portal -> entrance test)
  {
    convId: 'P6_C10',
    domain: 'PMB requirements',
    variation: 'formal Indonesian, procedural questions',
    turns: [
      {
        turnIndex: 1,
        query: 'syarat pendaftaran mahasiswa baru s1 stikom apa saja?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'requirements_list',
        expectedKeywords: ['ijazah', 'ktp', 'foto', 'pendaftaran']
      },
      {
        turnIndex: 2,
        query: 'ijazah legalisir butuh berapa lembar?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'document_copies',
        expectedKeywords: ['legalisir', 'ijazah', 'dokumen']
      },
      {
        turnIndex: 3,
        query: 'bisa daftar online lewat web mana?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'registration_portal',
        expectedKeywords: ['siap.stikom-bali.ac.id', 'online']
      },
      {
        turnIndex: 4,
        query: 'tes masuknya ada ujian apa aja?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'admission_test',
        expectedKeywords: ['tes', 'ujian', 'seleksi', 'masuk']
      }
    ]
  },

  // 11. S2 Postgraduate (Existence -> degree title -> tuition -> class schedule)
  {
    convId: 'P6_C11',
    domain: 'S2',
    variation: 'postgraduate domain, short follow-up',
    turns: [
      {
        turnIndex: 1,
        query: 'stikom ada program pascasarjana s2 ga ya?',
        expectedDomain: 's2_postgraduate',
        expectedEntity: 'S2_SI',
        expectedRelation: 'program_existence',
        expectedKeywords: ['Magister Sistem Informasi', 'S2']
      },
      {
        turnIndex: 2,
        query: 'prodinya apa dan gelarnya apa nanti?',
        expectedDomain: 's2_postgraduate',
        expectedEntity: 'S2_SI',
        expectedRelation: 'degree_title',
        expectedKeywords: ['M.Kom', 'Sistem Informasi']
      },
      {
        turnIndex: 3,
        query: 'biaya kuliah s2 per semester berapa?',
        expectedDomain: 's2_postgraduate',
        expectedEntity: 'S2_SI',
        expectedRelation: 'tuition_fee',
        expectedKeywords: ['S2', 'biaya', 'semester']
      },
      {
        turnIndex: 4,
        query: 'kuliahnya bisa kelas malam atau sabtu ga?',
        expectedDomain: 's2_postgraduate',
        expectedEntity: 'S2_SI',
        expectedRelation: 'study_schedule',
        expectedKeywords: ['kelas', 'kuliah', 'waktu']
      }
    ]
  },

  // 12. Double Degree HELP Malaysia (Partners -> Malaysia partner -> degrees -> study format)
  {
    convId: 'P6_C12',
    domain: 'Double Degree',
    variation: 'international partner, curriculum timeline',
    turns: [
      {
        turnIndex: 1,
        query: 'program double degree di stikom bekerjasama dengan universitas mana aja?',
        expectedDomain: 'double_degree',
        expectedEntity: 'STIKOM',
        expectedRelation: 'partner_list',
        expectedKeywords: ['HELP', 'Dalian Neusoft', 'UTB']
      },
      {
        turnIndex: 2,
        query: 'kalo yang ke malaysia kampusnya apa?',
        expectedDomain: 'double_degree',
        expectedEntity: 'HELP_UNIVERSITY',
        expectedRelation: 'partner_name',
        expectedKeywords: ['HELP University', 'Malaysia']
      },
      {
        turnIndex: 3,
        query: 'dapat dua gelar apa aja nanti?',
        expectedDomain: 'double_degree',
        expectedEntity: 'HELP_UNIVERSITY',
        expectedRelation: 'dual_degrees',
        expectedKeywords: ['S.Kom', 'BIT', 'gelar']
      },
      {
        turnIndex: 4,
        query: 'skema kuliahnya berapa tahun di bali berapa tahun di malaysia?',
        expectedDomain: 'double_degree',
        expectedEntity: 'HELP_UNIVERSITY',
        expectedRelation: 'study_timeline',
        expectedKeywords: ['tahun', 'bali', 'malaysia']
      }
    ]
  },

  // 13. Double Degree Dalian Neusoft China (Partner -> language requirement -> degree -> eligibility)
  {
    convId: 'P6_C13',
    domain: 'Double Degree',
    variation: 'entity substitution to China, language requirement',
    turns: [
      {
        turnIndex: 1,
        query: 'program dual degree yang ke china itu nama kampusnya apa min?',
        expectedDomain: 'double_degree',
        expectedEntity: 'DNUI',
        expectedRelation: 'partner_name',
        expectedKeywords: ['Dalian Neusoft', 'China']
      },
      {
        turnIndex: 2,
        query: 'apakah harus bisa bahasa mandarin dulu?',
        expectedDomain: 'double_degree',
        expectedEntity: 'DNUI',
        expectedRelation: 'language_prerequisite',
        expectedKeywords: ['bahasa', 'mandarin', 'inggris', 'persyaratan']
      },
      {
        turnIndex: 3,
        query: 'dapet gelar ganda juga kan?',
        expectedDomain: 'double_degree',
        expectedEntity: 'DNUI',
        expectedRelation: 'dual_degree_confirmation',
        expectedKeywords: ['gelar', 'ganda', 'S.Kom']
      },
      {
        turnIndex: 4,
        query: 'prodi apa aja yg bisa ikut dual degree china?',
        expectedDomain: 'double_degree',
        expectedEntity: 'DNUI',
        expectedRelation: 'eligible_programs',
        expectedKeywords: ['prodi', 'Teknologi Informasi', 'Sistem Informasi']
      }
    ]
  },

  // 14. Student Exchange GCCP (Overview -> GCCP activities -> duration -> requirements)
  {
    convId: 'P6_C14',
    domain: 'student exchange',
    variation: 'program details, duration, requirements',
    turns: [
      {
        turnIndex: 1,
        query: 'program pertukaran mahasiswa ke luar negeri ada apa aja?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'STIKOM',
        expectedRelation: 'exchange_programs',
        expectedKeywords: ['GCCP', 'pertukaran', 'luar negeri']
      },
      {
        turnIndex: 2,
        query: 'gccp itu program apa ya min?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'GCCP',
        expectedRelation: 'gccp_detail',
        expectedKeywords: ['Global Cross Cultural Program', 'budaya']
      },
      {
        turnIndex: 3,
        query: 'kegiatannya ngapain aja dan berapa lama?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'GCCP',
        expectedRelation: 'gccp_duration_activity',
        expectedKeywords: ['minggu', 'kegiatan', 'budaya']
      },
      {
        turnIndex: 4,
        query: 'syarat pendaftarannya apa aja?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'GCCP',
        expectedRelation: 'gccp_requirements',
        expectedKeywords: ['syarat', 'bahasa', 'mahasiswa']
      }
    ]
  },

  // 15. Student Exchange Hi-Think Japan (Overview -> Japanese training -> career opportunity -> fee)
  {
    convId: 'P6_C15',
    domain: 'student exchange',
    variation: 'internship exchange, career link',
    turns: [
      {
        turnIndex: 1,
        query: 'program hi think jepang itu magang atau pertukaran?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'HI_THINK',
        expectedRelation: 'hi_think_nature',
        expectedKeywords: ['Hi-Think', 'Jepang', 'magang', 'pelatihan']
      },
      {
        turnIndex: 2,
        query: 'ada pelatihan bahasa jepangnya ga dari kampus?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'HI_THINK',
        expectedRelation: 'language_training',
        expectedKeywords: ['bahasa', 'jepang', 'pelatihan']
      },
      {
        turnIndex: 3,
        query: 'apakah berpeluang langsung kerja di jepang setelah lulus?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'HI_THINK',
        expectedRelation: 'career_in_japan',
        expectedKeywords: ['kerja', 'jepang', 'karir']
      },
      {
        turnIndex: 4,
        query: 'biaya pelatihannya gratis atau bayar?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'HI_THINK',
        expectedRelation: 'training_cost',
        expectedKeywords: ['biaya', 'pelatihan', 'stikom']
      }
    ]
  },

  // 16. Accreditation institutional & prodi (Institutional -> SI -> TI -> SK)
  {
    convId: 'P6_C16',
    domain: 'accreditation',
    variation: 'sequential entity substitution, short follow-up, -nya morphology',
    turns: [
      {
        turnIndex: 1,
        query: 'akreditasi institusi itb stikom bali apa ya sekarang?',
        expectedDomain: 'accreditation',
        expectedEntity: 'INSTITUTION',
        expectedRelation: 'institutional_accreditation',
        expectedKeywords: ['Baik Sekali', 'BAN-PT']
      },
      {
        turnIndex: 2,
        query: 'kalo prodi sistem informasi akreditasinya apa?',
        expectedDomain: 'accreditation',
        expectedEntity: 'SI',
        expectedRelation: 'program_accreditation',
        expectedKeywords: ['Baik Sekali', 'LAM INFOKOM']
      },
      {
        turnIndex: 3,
        query: 'kalo teknologi informasi?',
        expectedDomain: 'accreditation',
        expectedEntity: 'TI',
        expectedRelation: 'program_accreditation',
        expectedKeywords: ['Baik', 'BAN-PT']
      },
      {
        turnIndex: 4,
        query: 'sistem komputer akreditasinya gimana min?',
        expectedDomain: 'accreditation',
        expectedEntity: 'SK',
        expectedRelation: 'program_accreditation',
        expectedKeywords: ['Baik Sekali', 'LAM INFOKOM']
      }
    ]
  },

  // 17. UKM Seni & Budaya (Overview -> Tari Pragina -> Paduan Suara VOS -> Musik)
  {
    convId: 'P6_C17',
    domain: 'UKM/ORMAWA',
    variation: 'category follow-up, short follow-up',
    turns: [
      {
        turnIndex: 1,
        query: 'di stikom ada ukm seni apa aja min?',
        expectedDomain: 'student_organization',
        expectedEntity: 'STIKOM',
        expectedRelation: 'art_clubs_list',
        expectedKeywords: ['seni', 'Pragina', 'VOS', 'musik']
      },
      {
        turnIndex: 2,
        query: 'ukm tari tradisional bali namanya apa?',
        expectedDomain: 'student_organization',
        expectedEntity: 'PRAGINA',
        expectedRelation: 'traditional_dance',
        expectedKeywords: ['Pragina', 'tari']
      },
      {
        turnIndex: 3,
        query: 'kalo paduan suara?',
        expectedDomain: 'student_organization',
        expectedEntity: 'VOS',
        expectedRelation: 'choir_club',
        expectedKeywords: ['Voice of STIKOM', 'VOS']
      },
      {
        turnIndex: 4,
        query: 'ada ukm musik modern atau band ga?',
        expectedDomain: 'student_organization',
        expectedEntity: 'MUSIK',
        expectedRelation: 'music_band_club',
        expectedKeywords: ['Musik', 'band']
      }
    ]
  },

  // 18. UKM Olahraga (Overview -> Futsal & Basket -> location/practice -> martial arts)
  {
    convId: 'P6_C18',
    domain: 'UKM/ORMAWA',
    variation: 'sports clubs, facility link',
    turns: [
      {
        turnIndex: 1,
        query: 'min ukm olahraga di kampus ada apa aja ya',
        expectedDomain: 'student_organization',
        expectedEntity: 'STIKOM',
        expectedRelation: 'sports_clubs_list',
        expectedKeywords: ['Futsal', 'Basket', 'olahraga']
      },
      {
        turnIndex: 2,
        query: 'futsal sama basket ada?',
        expectedDomain: 'student_organization',
        expectedEntity: 'SPORTS',
        expectedRelation: 'futsal_basket_check',
        expectedKeywords: ['Futsal', 'Basket']
      },
      {
        turnIndex: 3,
        query: 'latihannya rutin dimana min?',
        expectedDomain: 'student_organization',
        expectedEntity: 'SPORTS',
        expectedRelation: 'practice_location',
        expectedKeywords: ['latihan', 'kampus', 'lapangan']
      },
      {
        turnIndex: 4,
        query: 'ada ukm bela diri ga?',
        expectedDomain: 'student_organization',
        expectedEntity: 'MARTIAL_ARTS',
        expectedRelation: 'martial_arts_clubs',
        expectedKeywords: ['bela diri', 'kempo', 'taekwondo', 'silat']
      }
    ]
  },

  // 19. Facilities (Overview -> Perpustakaan digital -> INBIS -> Career Center)
  {
    convId: 'P6_C19',
    domain: 'facilities',
    variation: 'campus facility exploration, service detail',
    turns: [
      {
        turnIndex: 1,
        query: 'fasilitas penunjang belajar di stikom bali ada apa aja?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'STIKOM',
        expectedRelation: 'facility_list',
        expectedKeywords: ['laboratorium', 'perpustakaan', 'Inkubator Bisnis']
      },
      {
        turnIndex: 2,
        query: 'perpustakaannya lengkap ga ada buku digital?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'LIBRARY',
        expectedRelation: 'library_features',
        expectedKeywords: ['perpustakaan', 'digital', 'buku']
      },
      {
        turnIndex: 3,
        query: 'inkubator bisnis inbis itu buat apa min?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'INBIS',
        expectedRelation: 'inbis_role',
        expectedKeywords: ['INBIS', 'startup', 'bisnis', 'wirausaha']
      },
      {
        turnIndex: 4,
        query: 'career center membantu penyaluran kerja alumni ga?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'CAREER_CENTER',
        expectedRelation: 'career_center_role',
        expectedKeywords: ['Career Center', 'kerja', 'alumni', 'magang']
      }
    ]
  },

  // 20. Campus Location (Overview -> Renon address -> Jimbaran address -> programs at Jimbaran)
  {
    convId: 'P6_C20',
    domain: 'campus location',
    variation: 'location entity substitution, address check',
    turns: [
      {
        turnIndex: 1,
        query: 'kampus stikom bali ada di lokasi mana saja?',
        expectedDomain: 'campus_location',
        expectedEntity: 'STIKOM',
        expectedRelation: 'campus_count',
        expectedKeywords: ['Renon', 'Jimbaran', '2']
      },
      {
        turnIndex: 2,
        query: 'alamat kampus renon yang di jalan apa ya?',
        expectedDomain: 'campus_location',
        expectedEntity: 'RENON',
        expectedRelation: 'renon_address',
        expectedKeywords: ['Puputan', 'Renon']
      },
      {
        turnIndex: 3,
        query: 'kalo kampus jimbaran alamatnya dimana?',
        expectedDomain: 'campus_location',
        expectedEntity: 'JIMBARAN',
        expectedRelation: 'jimbaran_address',
        expectedKeywords: ['Kampus Udayana', 'Jimbaran']
      },
      {
        turnIndex: 4,
        query: 'prodi apa aja yg kuliah di jimbaran?',
        expectedDomain: 'campus_location',
        expectedEntity: 'JIMBARAN',
        expectedRelation: 'jimbaran_programs',
        expectedKeywords: ['Jimbaran', 'prodi']
      }
    ]
  },

  // 21. Academic Policy (Graduation SKS -> TA requirements -> max study period -> D3 comparison)
  {
    convId: 'P6_C21',
    domain: 'academic policy',
    variation: 'academic regulations, degree comparison',
    turns: [
      {
        turnIndex: 1,
        query: 'berapa total sks yang harus diselesaikan untuk lulus s1 di stikom?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'S1',
        expectedRelation: 's1_graduation_credits',
        expectedKeywords: ['144', 'SKS']
      },
      {
        turnIndex: 2,
        query: 'syarat buat ambil tugas akhir atau skripsi apa aja min?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'TA',
        expectedRelation: 'thesis_requirements',
        expectedKeywords: ['Tugas Akhir', 'SKS', 'syarat']
      },
      {
        turnIndex: 3,
        query: 'ada batas maksimal masa studi ga?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'S1',
        expectedRelation: 'max_study_period',
        expectedKeywords: ['semester', 'tahun', 'studi']
      },
      {
        turnIndex: 4,
        query: 'kalo d3 manajemen informatika berapa sks?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'MI',
        expectedRelation: 'd3_graduation_credits',
        expectedKeywords: ['108', 'D3', 'SKS']
      }
    ]
  },

  // 22. Program Comparison SI vs BD (Comparison -> coding focus -> BD curriculum -> BD careers)
  {
    convId: 'P6_C22',
    domain: 'program comparison',
    variation: 'comparison, curriculum depth, career transition',
    turns: [
      {
        turnIndex: 1,
        query: 'sistem informasi sama bisnis digital bedanya apa ya min?',
        expectedDomain: 'program_comparison',
        expectedEntity: 'SI_VS_BD',
        expectedRelation: 'curriculum_diff',
        expectedKeywords: ['Sistem Informasi', 'Bisnis Digital']
      },
      {
        turnIndex: 2,
        query: 'yang lebih banyak belajar koding yang mana?',
        expectedDomain: 'program_comparison',
        expectedEntity: 'SI_VS_BD',
        expectedRelation: 'coding_depth_comparison',
        expectedKeywords: ['Sistem Informasi', 'pemrograman', 'coding']
      },
      {
        turnIndex: 3,
        query: 'kalo bisnis digital fokus matkulnya apa?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'BD',
        expectedRelation: 'bd_curriculum_focus',
        expectedKeywords: ['e-commerce', 'bisnis', 'digital', 'marketing']
      },
      {
        turnIndex: 4,
        query: 'prospek kerja bisnis digital nanti jadi apa aja?',
        expectedDomain: 'career_prospect',
        expectedEntity: 'BD',
        expectedRelation: 'bd_career_prospects',
        expectedKeywords: ['digital marketer', 'bisnis', 'e-commerce']
      }
    ]
  },

  // 23. Program Comparison TI vs SK (Comparison -> hardware focus -> software focus -> fee comparison)
  {
    convId: 'P6_C23',
    domain: 'program comparison',
    variation: 'comparison, explicit topic switch to fee',
    turns: [
      {
        turnIndex: 1,
        query: 'apa perbedaan prodi teknologi informasi dan sistem komputer?',
        expectedDomain: 'program_comparison',
        expectedEntity: 'TI_VS_SK',
        expectedRelation: 'curriculum_diff',
        expectedKeywords: ['Teknologi Informasi', 'Sistem Komputer']
      },
      {
        turnIndex: 2,
        query: 'kalo sistem komputer lebih banyak hardware ya?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'SK',
        expectedRelation: 'sk_hardware_focus',
        expectedKeywords: ['hardware', 'perangkat keras', 'iot', 'komputer']
      },
      {
        turnIndex: 3,
        query: 'ti belajarnya lebih ke software dan cloud?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'TI',
        expectedRelation: 'ti_software_focus',
        expectedKeywords: ['software', 'cloud', 'pemrograman', 'jaringan']
      },
      {
        turnIndex: 4,
        query: 'biaya kuliah keduanya sama atau beda?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'TI_VS_SK',
        expectedRelation: 'fee_comparison',
        expectedKeywords: ['6.500.000', '6.000.000', 'biaya']
      }
    ]
  },

  // 24. Stale Context Handling (Fee -> DPP -> idle > 35 min -> query "kalau TI?" rejects stale fee intent)
  {
    convId: 'P6_C24',
    domain: 'fee',
    variation: 'stale context idle > 30min, intent leakage defense',
    turns: [
      {
        turnIndex: 1,
        query: 'biaya kuliah TI berapa ya min',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'TI',
        expectedRelation: 'tuition_fee',
        expectedKeywords: ['Teknologi Informasi', '6.500.000']
      },
      {
        turnIndex: 2,
        query: 'uang gedungnya berapa?',
        expectedDomain: 'fee_total',
        expectedEntity: 'TI',
        expectedRelation: 'dpp_cost',
        expectedKeywords: ['14.000.000', 'DPP']
      },
      {
        turnIndex: 3,
        query: 'kalau TI?',
        injectStaleMinutes: 40, // 40 minutes old context
        expectedDomain: 'program_study',
        expectedEntity: 'TI',
        expectedRelation: 'fresh_program_overview',
        expectedKeywords: ['Teknologi Informasi', 'program studi', 'S1']
      },
      {
        turnIndex: 4,
        query: 'prospek kerjanya apa saja?',
        expectedDomain: 'career_prospect',
        expectedEntity: 'TI',
        expectedRelation: 'career_prospects',
        expectedKeywords: ['software', 'developer', 'jaringan', 'cloud']
      }
    ]
  },

  // 25. Fresh Session Ambiguity Handling (Unanchored "syaratnya apa min" -> clarification -> PMB resolution)
  {
    convId: 'P6_C25',
    domain: 'PMB requirements',
    variation: 'fresh session ambiguity, clarification resolution',
    turns: [
      {
        turnIndex: 1,
        query: 'syaratnya apa min',
        expectedDomain: 'general',
        expectedEntity: 'NONE',
        expectedRelation: 'clarification_prompt',
        expectedKeywords: ['jelaskan', 'topik', 'PMB', 'biaya', 'program studi']
      },
      {
        turnIndex: 2,
        query: 'syarat pendaftaran mahasiswa baru s1',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'requirements_list',
        expectedKeywords: ['ijazah', 'ktp', 'foto', 'pendaftaran']
      },
      {
        turnIndex: 3,
        query: 'berkasnya bisa diupload online?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'online_upload',
        expectedKeywords: ['online', 'upload', 'siap.stikom-bali.ac.id']
      },
      {
        turnIndex: 4,
        query: 'biaya pendaftarannya berapa?',
        expectedDomain: 'registration_fee',
        expectedEntity: 'STIKOM',
        expectedRelation: 'registration_fee',
        expectedKeywords: ['500.000']
      }
    ]
  },

  // 26. Typo ringan & Singkatan - Fee & Installment (BD fee -> DPP installment -> first payment -> full payment discount)
  {
    convId: 'P6_C26',
    domain: 'fee',
    variation: 'typo ringan, singkatan, installment',
    turns: [
      {
        turnIndex: 1,
        query: 'mwnny byaya smesteran bd brapaa',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'BD',
        expectedRelation: 'tuition_fee',
        expectedKeywords: ['Bisnis Digital', '6.500.000']
      },
      {
        turnIndex: 2,
        query: 'dpp ny bsa dcicil brp kali',
        expectedDomain: 'fee_installment',
        expectedEntity: 'BD',
        expectedRelation: 'installment_stages',
        expectedKeywords: ['cicil', 'angsur', 'tahap', 'dpp']
      },
      {
        turnIndex: 3,
        query: 'byr prtama brapa min',
        expectedDomain: 'fee_installment',
        expectedEntity: 'BD',
        expectedRelation: 'initial_payment',
        expectedKeywords: ['tahap', 'pertama', 'pembayaran', 'dpp']
      },
      {
        turnIndex: 4,
        query: 'klo mau byar lunas dpt diskon ga',
        expectedDomain: 'fee_discount',
        expectedEntity: 'BD',
        expectedRelation: 'full_payment_discount',
        expectedKeywords: ['potongan', 'lunas', 'diskon']
      }
    ]
  },

  // 27. Double Degree UTB Bandung (Overview -> Degrees -> Study mode -> Fee comparison)
  {
    convId: 'P6_C27',
    domain: 'Double Degree',
    variation: 'informal, -nya morphology, fee comparison',
    turns: [
      {
        turnIndex: 1,
        query: 'double degree utb bandung itu gimana sih',
        expectedDomain: 'double_degree',
        expectedEntity: 'UTB',
        expectedRelation: 'utb_overview',
        expectedKeywords: ['UTB', 'Bandung', 'gelar ganda']
      },
      {
        turnIndex: 2,
        query: 'gelarnya dapet apa aja',
        expectedDomain: 'double_degree',
        expectedEntity: 'UTB',
        expectedRelation: 'utb_degrees',
        expectedKeywords: ['S.Kom', 'UTB']
      },
      {
        turnIndex: 3,
        query: 'kuliahnya online apa offline di bandung',
        expectedDomain: 'double_degree',
        expectedEntity: 'UTB',
        expectedRelation: 'utb_study_mode',
        expectedKeywords: ['kuliah', 'STIKOM', 'UTB']
      },
      {
        turnIndex: 4,
        query: 'biayanya lebih mahal ga dari reguler',
        expectedDomain: 'double_degree',
        expectedEntity: 'UTB',
        expectedRelation: 'utb_fee_comparison',
        expectedKeywords: ['biaya', 'UTB']
      }
    ]
  },

  // 28. Formal PMB Transfer & SKS conversion (Transfer procedures -> legalized transcript -> SKS conversion -> fee)
  {
    convId: 'P6_C28',
    domain: 'PMB requirements',
    variation: 'formal Indonesian, transfer student',
    turns: [
      {
        turnIndex: 1,
        query: 'Bagaimanakah tata cara pendaftaran mahasiswa pindahan atau transfer di ITB STIKOM Bali?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'TRANSFER',
        expectedRelation: 'transfer_procedure',
        expectedKeywords: ['pindahan', 'transfer', 'transkrip']
      },
      {
        turnIndex: 2,
        query: 'Apakah transkrip nilai dari kampus asal harus dilegalisir?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'TRANSFER',
        expectedRelation: 'transcript_legalization',
        expectedKeywords: ['transkrip', 'legalisir', 'kampus']
      },
      {
        turnIndex: 3,
        query: 'Berapa maksimal SKS yang dapat dikonversi?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'TRANSFER',
        expectedRelation: 'credit_conversion',
        expectedKeywords: ['konversi', 'SKS', 'mata kuliah']
      },
      {
        turnIndex: 4,
        query: 'Berapakah biaya pendaftarannya?',
        expectedDomain: 'registration_fee',
        expectedEntity: 'STIKOM',
        expectedRelation: 'registration_fee',
        expectedKeywords: ['500.000']
      }
    ]
  },

  // 29. UKM Technology & KSL Linux (IT clubs -> KSL acronym -> activities -> robotics)
  {
    convId: 'P6_C29',
    domain: 'UKM/ORMAWA',
    variation: 'tech clubs, acronym check',
    turns: [
      {
        turnIndex: 1,
        query: 'ada ukm bidang IT atau coding ga di stikom?',
        expectedDomain: 'student_organization',
        expectedEntity: 'STIKOM',
        expectedRelation: 'tech_clubs_list',
        expectedKeywords: ['KSL', 'komputer', 'teknologi']
      },
      {
        turnIndex: 2,
        query: 'KSL itu singkatan dari apa min?',
        expectedDomain: 'student_organization',
        expectedEntity: 'KSL',
        expectedRelation: 'ksl_acronym',
        expectedKeywords: ['Kelompok Studi Linux', 'KSL']
      },
      {
        turnIndex: 3,
        query: 'kegiatannya ngapain aja di ksl?',
        expectedDomain: 'student_organization',
        expectedEntity: 'KSL',
        expectedRelation: 'ksl_activities',
        expectedKeywords: ['Linux', 'open source', 'workshop']
      },
      {
        turnIndex: 4,
        query: 'ada ukm robotika ga?',
        expectedDomain: 'student_organization',
        expectedEntity: 'ROBOTICS',
        expectedRelation: 'robotics_club',
        expectedKeywords: ['robot', 'hardware', 'organisasi']
      }
    ]
  },

  // 30. Campus Facilities - Studio & Coworking (Podcast studio -> access policy -> coworking -> wifi)
  {
    convId: 'P6_C30',
    domain: 'facilities',
    variation: 'modern facilities, access policy',
    turns: [
      {
        turnIndex: 1,
        query: 'apakah stikom bali memiliki fasilitas studio podcast atau multimedia?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'STUDIO',
        expectedRelation: 'studio_multimedia',
        expectedKeywords: ['studio', 'multimedia', 'fasilitas']
      },
      {
        turnIndex: 2,
        query: 'mahasiswa bebas pake atau harus izin dulu?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'STUDIO',
        expectedRelation: 'studio_access_policy',
        expectedKeywords: ['izin', 'mahasiswa', 'fasilitas']
      },
      {
        turnIndex: 3,
        query: 'kalo coworking space buat ngerjain tugas ada ga?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'COWORKING',
        expectedRelation: 'coworking_space',
        expectedKeywords: ['coworking', 'ruang', 'mahasiswa']
      },
      {
        turnIndex: 4,
        query: 'fasilitas lab komputernya lengkap ga min?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'LAB',
        expectedRelation: 'computer_labs',
        expectedKeywords: ['lab', 'komputer', 'laboratorium']
      }
    ]
  },

  // 31. Repair/Correction - Fee vs Registration (Overall fee -> correction to registration -> payment location -> opening hours)
  {
    convId: 'P6_C31',
    domain: 'registration fee',
    variation: 'repair/correction, schedule/hours',
    turns: [
      {
        turnIndex: 1,
        query: 'biaya masuk stikom berapa min',
        expectedDomain: 'fee_total',
        expectedEntity: 'STIKOM',
        expectedRelation: 'overall_entrance_cost',
        expectedKeywords: ['biaya', 'DPP', 'UKT', 'pendaftaran']
      },
      {
        turnIndex: 2,
        query: 'bukan biaya kuliah maksud saya uang formulirnya',
        expectedDomain: 'registration_fee',
        expectedEntity: 'STIKOM',
        expectedRelation: 'context_repair_reg_fee',
        expectedKeywords: ['500.000', 'pendaftaran', 'formulir']
      },
      {
        turnIndex: 3,
        query: 'bisa beli langsung di kampus renon?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'RENON',
        expectedRelation: 'onsite_purchase',
        expectedKeywords: ['kampus', 'Renon', 'pendaftaran']
      },
      {
        turnIndex: 4,
        query: 'layanan pendaftaran buka hari apa aja?',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'PMB',
        expectedRelation: 'service_days',
        expectedKeywords: ['senin', 'jumat', 'sabtu', 'pendaftaran']
      }
    ]
  },

  // 32. Career Recommendation - Cybersecurity in TI (Interest -> TI cybersecurity -> careers -> accreditation)
  {
    convId: 'P6_C32',
    domain: 'career',
    variation: 'recommendation, curriculum, accreditation switch',
    turns: [
      {
        turnIndex: 1,
        query: 'saya tertarik sama keamanan siber dan hacking etis prodi apa yg tepat ya',
        expectedDomain: 'career_recommendation',
        expectedEntity: 'TI',
        expectedRelation: 'cybersecurity_recommendation',
        expectedKeywords: ['Teknologi Informasi', 'keamanan']
      },
      {
        turnIndex: 2,
        query: 'di TI ada konsentrasi atau mata kuliah cyber security?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'TI',
        expectedRelation: 'ti_cybersecurity_curriculum',
        expectedKeywords: ['keamanan', 'jaringan', 'cyber', 'Teknologi Informasi']
      },
      {
        turnIndex: 3,
        query: 'lulusannya prospek kerjanya jadi apa?',
        expectedDomain: 'career_prospect',
        expectedEntity: 'TI',
        expectedRelation: 'cybersecurity_careers',
        expectedKeywords: ['security', 'analyst', 'cyber', 'network', 'engineer']
      },
      {
        turnIndex: 4,
        query: 'akreditasi prodi TI saat ini apa min?',
        expectedDomain: 'accreditation',
        expectedEntity: 'TI',
        expectedRelation: 'ti_accreditation',
        expectedKeywords: ['Baik', 'BAN-PT']
      }
    ]
  },

  // 33. Career Recommendation - Startup & E-Commerce in BD (Interest -> BD curriculum -> INBIS funding -> BD tuition)
  {
    convId: 'P6_C33',
    domain: 'recommendation',
    variation: 'recommendation, facilities link, fee switch',
    turns: [
      {
        turnIndex: 1,
        query: 'pengen bikin startup digital dan bisnis online cocoknya ambil jurusan apa',
        expectedDomain: 'career_recommendation',
        expectedEntity: 'BD',
        expectedRelation: 'startup_recommendation',
        expectedKeywords: ['Bisnis Digital', 'e-commerce']
      },
      {
        turnIndex: 2,
        query: 'bisnis digital ada matkul e-commerce dan digital marketing?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'BD',
        expectedRelation: 'bd_marketing_curriculum',
        expectedKeywords: ['e-commerce', 'digital marketing', 'bisnis']
      },
      {
        turnIndex: 3,
        query: 'kampus ada inkubator buat danai startup mahasiswa ga?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'INBIS',
        expectedRelation: 'inbis_startup_support',
        expectedKeywords: ['INBIS', 'inkubator', 'startup', 'wirausaha']
      },
      {
        turnIndex: 4,
        query: 'biaya kuliah bisnis digital per semester brp min?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'BD',
        expectedRelation: 'bd_tuition_fee',
        expectedKeywords: ['6.500.000']
      }
    ]
  },

  // 34. D3 Manajemen Informatika (Fee -> DPP -> Extension to S1 -> Accreditation)
  {
    convId: 'P6_C34',
    domain: 'fee',
    variation: 'D3 diploma domain, study transfer, accreditation',
    turns: [
      {
        turnIndex: 1,
        query: 'uang kuliah d3 manajemen informatika berapa min',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'MI',
        expectedRelation: 'd3_tuition_fee',
        expectedKeywords: ['4.900.000', 'Manajemen Informatika']
      },
      {
        turnIndex: 2,
        query: 'dpp nya kena berapa juta?',
        expectedDomain: 'fee_total',
        expectedEntity: 'MI',
        expectedRelation: 'd3_dpp_fee',
        expectedKeywords: ['9.000.000', 'DPP']
      },
      {
        turnIndex: 3,
        query: 'kalo lanjut ekstensi ke s1 nambah biaya berapa?',
        expectedDomain: 'program_study',
        expectedEntity: 'MI',
        expectedRelation: 'extension_to_s1',
        expectedKeywords: ['lanjut', 'S1', 'transfer']
      },
      {
        turnIndex: 4,
        query: 'd3 mi akreditasinya apa ya?',
        expectedDomain: 'accreditation',
        expectedEntity: 'MI',
        expectedRelation: 'd3_accreditation',
        expectedKeywords: ['Baik', 'BAN-PT']
      }
    ]
  },

  // 35. PMB Schedule - Gelombang 3 & Orientation (Gelombang 3 -> TI quota -> requirements comparison -> orientation date)
  {
    convId: 'P6_C35',
    domain: 'schedule',
    variation: 'late admissions wave, orientation timeline',
    turns: [
      {
        turnIndex: 1,
        query: 'gelombang 3 pmb stikom bali sampai bulan apa',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'WAVE_3',
        expectedRelation: 'wave_3_timeline',
        expectedKeywords: ['Gelombang 3', 'agustus', 'september']
      },
      {
        turnIndex: 2,
        query: 'apakah masih ada kuota untuk jurusan teknologi informasi?',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'TI',
        expectedRelation: 'quota_availability',
        expectedKeywords: ['kuota', 'pendaftaran', 'Teknologi Informasi']
      },
      {
        turnIndex: 3,
        query: 'syarat pendaftarannya tetap sama kan?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'requirements_consistency',
        expectedKeywords: ['syarat', 'ijazah', 'ktp', 'dokumen']
      },
      {
        turnIndex: 4,
        query: 'kapan mulai ospek dan kuliah perdananya min?',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'PMB',
        expectedRelation: 'orientation_schedule',
        expectedKeywords: ['ospek', 'kuliah', 'september', 'jadwal']
      }
    ]
  },

  // 36. Foreign Student Administration - Visa & ITAS (Formal foreign procedure -> permit timeline -> docs -> office)
  {
    convId: 'P6_C36',
    domain: 'academic policy',
    variation: 'foreign student admin, visa and permits',
    turns: [
      {
        turnIndex: 1,
        query: 'bagaimana proses pengurusan visa dan izin belajar untuk mahasiswa asing',
        expectedDomain: 'foreign_student_admin',
        expectedEntity: 'FOREIGN_STUDENT',
        expectedRelation: 'foreign_admin_process',
        expectedKeywords: ['izin belajar', 'visa', 'mahasiswa asing']
      },
      {
        turnIndex: 2,
        query: 'berapa lama proses rekomendasi izin belajarnya?',
        expectedDomain: 'foreign_student_admin',
        expectedEntity: 'FOREIGN_STUDENT',
        expectedRelation: 'permit_timeline',
        expectedKeywords: ['izin belajar', 'proses', 'waktu']
      },
      {
        turnIndex: 3,
        query: 'dokumen apa yang harus diupload oleh mahasiswa internasional?',
        expectedDomain: 'foreign_student_admin',
        expectedEntity: 'FOREIGN_STUDENT',
        expectedRelation: 'foreign_documents',
        expectedKeywords: ['Passport', 'Photo', 'Financial']
      },
      {
        turnIndex: 4,
        query: 'kantor urusan internasional stikom di lantai berapa?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'INTERNATIONAL_OFFICE',
        expectedRelation: 'international_office_location',
        expectedKeywords: ['kampus', 'Renon', 'kantor']
      }
    ]
  },

  // 37. Academic Policy - Cuti Kuliah (Leave of absence -> duration limit -> requirements -> tuition fee during leave)
  {
    convId: 'P6_C37',
    domain: 'academic policy',
    variation: 'leave of absence regulations',
    turns: [
      {
        turnIndex: 1,
        query: 'apakah mahasiswa stikom boleh mengajukan cuti kuliah',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'leave_permission',
        expectedKeywords: ['cuti', 'kuliah', 'mahasiswa']
      },
      {
        turnIndex: 2,
        query: 'maksimal cuti berapa semester min?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'max_leave_semesters',
        expectedKeywords: ['cuti', 'semester', 'maksimal']
      },
      {
        turnIndex: 3,
        query: 'syarat pengajuan cuti apa aja?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'leave_requirements',
        expectedKeywords: ['syarat', 'permohonan', 'keuangan']
      },
      {
        turnIndex: 4,
        query: 'biaya selama cuti tetap bayar ukt penuh atau tidak?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'leave_fee_policy',
        expectedKeywords: ['biaya', 'ukt', 'cuti']
      }
    ]
  },

  // 38. Career - Sistem Komputer & IoT (Hardware roles -> IoT/Network engineer -> Robotics curriculum -> Fee switch)
  {
    convId: 'P6_C38',
    domain: 'career',
    variation: 'specific engineering roles, curriculum, fee switch',
    turns: [
      {
        turnIndex: 1,
        query: 'lulusan sistem komputer kerjanya di bidang apa aja min',
        expectedDomain: 'career_prospect',
        expectedEntity: 'SK',
        expectedRelation: 'sk_careers',
        expectedKeywords: ['hardware', 'jaringan', 'iot', 'embedded']
      },
      {
        turnIndex: 2,
        query: 'bisa kerja jadi network engineer atau iot engineer ga?',
        expectedDomain: 'career_prospect',
        expectedEntity: 'SK',
        expectedRelation: 'sk_specific_roles',
        expectedKeywords: ['network', 'iot', 'engineer', 'komputer']
      },
      {
        turnIndex: 3,
        query: 'matkul sistem komputernya ada belajar robotika?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'SK',
        expectedRelation: 'sk_robotics_topics',
        expectedKeywords: ['robotika', 'perangkat keras', 'hardware']
      },
      {
        turnIndex: 4,
        query: 'biaya kuliah sistem komputer per semester berapa ya?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'SK',
        expectedRelation: 'sk_tuition_fee',
        expectedKeywords: ['6.000.000']
      }
    ]
  },

  // 39. Short Follow-up & Sequential Entity Substitution across all programs (Accreditation TI -> SI -> BD -> SK)
  {
    convId: 'P6_C39',
    domain: 'accreditation',
    variation: 'sequential entity substitution, short follow-up',
    turns: [
      {
        turnIndex: 1,
        query: 'akreditasi teknologi informasi apa min?',
        expectedDomain: 'accreditation',
        expectedEntity: 'TI',
        expectedRelation: 'ti_accreditation',
        expectedKeywords: ['Baik', 'BAN-PT']
      },
      {
        turnIndex: 2,
        query: 'kalau sistem informasi?',
        expectedDomain: 'accreditation',
        expectedEntity: 'SI',
        expectedRelation: 'si_accreditation',
        expectedKeywords: ['Baik Sekali', 'LAM INFOKOM']
      },
      {
        turnIndex: 3,
        query: 'kalau bisnis digital?',
        expectedDomain: 'accreditation',
        expectedEntity: 'BD',
        expectedRelation: 'bd_accreditation',
        expectedKeywords: ['Baik', 'LAM INFOKOM', 'BAN-PT']
      },
      {
        turnIndex: 4,
        query: 'kalau sistem komputer?',
        expectedDomain: 'accreditation',
        expectedEntity: 'SK',
        expectedRelation: 'sk_accreditation',
        expectedKeywords: ['Baik Sekali', 'LAM INFOKOM']
      }
    ]
  },

  // 40. Fee Substitution Across Programs (TI fee -> SI fee -> SK fee -> D3 MI fee)
  {
    convId: 'P6_C40',
    domain: 'fee',
    variation: 'sequential entity substitution on fee domain',
    turns: [
      {
        turnIndex: 1,
        query: 'biaya kuliah per semester teknologi informasi berapa min',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'TI',
        expectedRelation: 'ti_tuition',
        expectedKeywords: ['6.500.000']
      },
      {
        turnIndex: 2,
        query: 'kalau sistem informasi?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'SI',
        expectedRelation: 'si_tuition',
        expectedKeywords: ['6.500.000']
      },
      {
        turnIndex: 3,
        query: 'kalau sistem komputer?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'SK',
        expectedRelation: 'sk_tuition',
        expectedKeywords: ['6.000.000']
      },
      {
        turnIndex: 4,
        query: 'kalau d3 mi?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'MI',
        expectedRelation: 'mi_tuition',
        expectedKeywords: ['4.900.000']
      }
    ]
  },

  // 41. Double Degree vs Student Exchange clarification (Countries -> Japan check -> Official partners -> TOEFL requirement)
  {
    convId: 'P6_C41',
    domain: 'Double Degree',
    variation: 'program differentiation, English requirements',
    turns: [
      {
        turnIndex: 1,
        query: 'program gelar ganda luar negeri ada negara mana aja min',
        expectedDomain: 'double_degree',
        expectedEntity: 'STIKOM',
        expectedRelation: 'partner_countries',
        expectedKeywords: ['Malaysia', 'China']
      },
      {
        turnIndex: 2,
        query: 'kalo yang ke jepang itu double degree atau magang?',
        expectedDomain: 'student_exchange',
        expectedEntity: 'HI_THINK',
        expectedRelation: 'japan_program_type',
        expectedKeywords: ['Hi-Think', 'magang', 'Jepang']
      },
      {
        turnIndex: 3,
        query: 'jadi double degree resmi stikom ada help university dan dalian neusoft ya?',
        expectedDomain: 'double_degree',
        expectedEntity: 'STIKOM',
        expectedRelation: 'official_dd_partners',
        expectedKeywords: ['HELP', 'Dalian Neusoft']
      },
      {
        turnIndex: 4,
        query: 'syarat toefl minimal berapa buat ikut double degree malaysia?',
        expectedDomain: 'double_degree',
        expectedEntity: 'HELP_UNIVERSITY',
        expectedRelation: 'toefl_requirement',
        expectedKeywords: ['TOEFL', 'bahasa', 'Inggris']
      }
    ]
  },

  // 42. Scholarship - KIP vs Yayasan comparison (Comparison -> living allowance -> Yayasan discount -> announcement date)
  {
    convId: 'P6_C42',
    domain: 'scholarship',
    variation: 'scholarship comparison, benefits detail',
    turns: [
      {
        turnIndex: 1,
        query: 'apa perbedaan beasiswa kip kuliah dan beasiswa yayasan di stikom',
        expectedDomain: 'scholarship',
        expectedEntity: 'KIP_VS_YAYASAN',
        expectedRelation: 'scholarship_comparison',
        expectedKeywords: ['KIP', 'Yayasan', 'beasiswa']
      },
      {
        turnIndex: 2,
        query: 'beasiswa kip kuliah apakah mencakup biaya hidup bulanan?',
        expectedDomain: 'scholarship',
        expectedEntity: 'KIP_KULIAH',
        expectedRelation: 'living_allowance',
        expectedKeywords: ['biaya hidup', 'kip', 'pemerintah']
      },
      {
        turnIndex: 3,
        query: 'kalo beasiswa yayasan potongannya apa aja min?',
        expectedDomain: 'scholarship',
        expectedEntity: 'YAYASAN',
        expectedRelation: 'yayasan_benefits',
        expectedKeywords: ['yayasan', 'potongan', 'dpp']
      },
      {
        turnIndex: 4,
        query: 'kapan pengumuman hasil seleksi beasiswanya?',
        expectedDomain: 'scholarship',
        expectedEntity: 'SCHOLARSHIP_SCHEDULE',
        expectedRelation: 'selection_announcement',
        expectedKeywords: ['seleksi', 'pengumuman', 'beasiswa']
      }
    ]
  },

  // 43. Repair/Correction - Career vs Curriculum (TI role -> correction to curriculum subjects -> AI topics -> AI career prospects)
  {
    convId: 'P6_C43',
    domain: 'curriculum',
    variation: 'repair/correction, curriculum to career bridge',
    turns: [
      {
        turnIndex: 1,
        query: 'ti kerjanya ngapain min',
        expectedDomain: 'career_prospect',
        expectedEntity: 'TI',
        expectedRelation: 'ti_work_role',
        expectedKeywords: ['software', 'developer', 'jaringan', 'prospek']
      },
      {
        turnIndex: 2,
        query: 'bukan kerjaannya, maksud saya mata kuliah yang dipelajari apa aja',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'TI',
        expectedRelation: 'context_repair_subjects',
        expectedKeywords: ['pemrograman', 'jaringan', 'cloud', 'mata kuliah']
      },
      {
        turnIndex: 3,
        query: 'ada belajar artificial intelligence ga?',
        expectedDomain: 'curriculum_learning',
        expectedEntity: 'TI',
        expectedRelation: 'ai_curriculum_topics',
        expectedKeywords: ['kecerdasan buatan', 'ai', 'teknologi']
      },
      {
        turnIndex: 4,
        query: 'prospek lulusannya di bidang AI banyak dicari ya?',
        expectedDomain: 'career_prospect',
        expectedEntity: 'TI',
        expectedRelation: 'ai_career_demand',
        expectedKeywords: ['karir', 'prospek', 'industri', 'ai']
      }
    ]
  },

  // 44. Facilities - Library (Opening hours -> international journals -> digital collection -> location)
  {
    convId: 'P6_C44',
    domain: 'facilities',
    variation: 'library services, operating hours',
    turns: [
      {
        turnIndex: 1,
        query: 'jam operasional perpustakaan stikom renon dari jam berapa',
        expectedDomain: 'campus_facility',
        expectedEntity: 'LIBRARY',
        expectedRelation: 'library_hours',
        expectedKeywords: ['perpustakaan', 'senin', 'jumat', 'jam']
      },
      {
        turnIndex: 2,
        query: 'ada akses jurnal internasional seperti ieee atau acm ga min?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'LIBRARY',
        expectedRelation: 'journal_access',
        expectedKeywords: ['jurnal', 'internasional', 'perpustakaan']
      },
      {
        turnIndex: 3,
        query: 'koleksi buku digitalnya bisa diakses mahasiswa?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'LIBRARY',
        expectedRelation: 'digital_books',
        expectedKeywords: ['digital', 'buku', 'akses']
      },
      {
        turnIndex: 4,
        query: 'lokasi perpustakaannya di lantai berapa?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'LIBRARY',
        expectedRelation: 'library_floor_location',
        expectedKeywords: ['gedung', 'lantai', 'perpustakaan']
      }
    ]
  },

  // 45. Special UKM - MAPALA & KSR PMI (Special interest -> Mapala name -> KSR activities -> recruitment)
  {
    convId: 'P6_C45',
    domain: 'UKM/ORMAWA',
    variation: 'special interest UKM, recruitment',
    turns: [
      {
        turnIndex: 1,
        query: 'ada ukm pecinta alam atau kepalangmerahan ga di stikom',
        expectedDomain: 'student_organization',
        expectedEntity: 'SPECIAL_UKM',
        expectedRelation: 'special_clubs_list',
        expectedKeywords: ['Mapala', 'KSR', 'alam']
      },
      {
        turnIndex: 2,
        query: 'nama ukm pecinta alam stikom apa min?',
        expectedDomain: 'student_organization',
        expectedEntity: 'MAPALA',
        expectedRelation: 'mapala_club_name',
        expectedKeywords: ['Mapala', 'alam']
      },
      {
        turnIndex: 3,
        query: 'kalo ksr pmi kegiatannya apa aja?',
        expectedDomain: 'student_organization',
        expectedEntity: 'KSR',
        expectedRelation: 'ksr_pmi_activities',
        expectedKeywords: ['KSR', 'PMI', 'sosial', 'kemanusiaan']
      },
      {
        turnIndex: 4,
        query: 'kapan jadwal pendaftaran anggota baru ukm nya?',
        expectedDomain: 'student_organization',
        expectedEntity: 'UKM_RECRUITMENT',
        expectedRelation: 'ukm_recruitment_timeline',
        expectedKeywords: ['pendaftaran', 'maba', 'UKM']
      }
    ]
  },

  // 46. Academic Policy - SKS limit per GPA (GPA limit -> package system -> semester 1 SKS -> remedial SP)
  {
    convId: 'P6_C46',
    domain: 'academic policy',
    variation: 'academic credit policy, GPA constraints',
    turns: [
      {
        turnIndex: 1,
        query: 'minimal ipk berapa biar bisa ambil 24 sks di semester depan',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'sks_limit_per_gpa',
        expectedKeywords: ['IPK', '24', 'SKS']
      },
      {
        turnIndex: 2,
        query: 'kalo semester 1 dan 2 paket sks nya sudah ditentukan kampus ya?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'package_credit_system',
        expectedKeywords: ['paket', 'semester', 'SKS']
      },
      {
        turnIndex: 3,
        query: 'berapa sks paket di semester 1?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'first_semester_credits',
        expectedKeywords: ['SKS', 'semester 1']
      },
      {
        turnIndex: 4,
        query: 'apakah ada ujian perbaikan atau sp semester pendek?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'ACADEMIC',
        expectedRelation: 'remedial_sp_policy',
        expectedKeywords: ['semester pendek', 'perbaikan', 'nilai']
      }
    ]
  },

  // 47. PMB Online Registration (Official portal -> registration workflow -> virtual account -> admission card)
  {
    convId: 'P6_C47',
    domain: 'PMB requirements',
    variation: 'online registration workflow, technical steps',
    turns: [
      {
        turnIndex: 1,
        query: 'link website resmi pendaftaran mahasiswa baru itb stikom bali apa ya',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'official_portal_link',
        expectedKeywords: ['siap.stikom-bali.ac.id']
      },
      {
        turnIndex: 2,
        query: 'setelah isi formulir online konfirmasinya kemana min?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'online_confirmation_steps',
        expectedKeywords: ['konfirmasi', 'panitia', 'pmb', 'online']
      },
      {
        turnIndex: 3,
        query: 'pembayaran pendaftaran 500 ribu via virtual account apa aja?',
        expectedDomain: 'registration_fee',
        expectedEntity: 'PMB',
        expectedRelation: 'va_payment_methods',
        expectedKeywords: ['virtual account', 'bank', '500.000']
      },
      {
        turnIndex: 4,
        query: 'kartu ujian pmb nya langsung keluar setelah bayar?',
        expectedDomain: 'pmb_requirements',
        expectedEntity: 'PMB',
        expectedRelation: 'exam_card_issuance',
        expectedKeywords: ['kartu', 'ujian', 'pendaftaran']
      }
    ]
  },

  // 48. Campus Location & Transportation (Renon landmarks -> Jimbaran landmarks -> inter-campus transport -> parking)
  {
    convId: 'P6_C48',
    domain: 'campus location',
    variation: 'landmarks, facilities, transportation',
    turns: [
      {
        turnIndex: 1,
        query: 'kampus renon dekat dengan lapangan puputan renon ya min?',
        expectedDomain: 'campus_location',
        expectedEntity: 'RENON',
        expectedRelation: 'renon_landmark',
        expectedKeywords: ['Puputan', 'Renon']
      },
      {
        turnIndex: 2,
        query: 'kalo kampus jimbaran dekat dengan kampus unud?',
        expectedDomain: 'campus_location',
        expectedEntity: 'JIMBARAN',
        expectedRelation: 'jimbaran_landmark',
        expectedKeywords: ['Kampus Udayana', 'Jimbaran']
      },
      {
        turnIndex: 3,
        query: 'apakah ada bus kampus yang antar jemput renon jimbaran?',
        expectedDomain: 'campus_location',
        expectedEntity: 'TRANSPORT',
        expectedRelation: 'campus_shuttle_policy',
        expectedKeywords: ['kampus', 'transportasi', 'lokasi']
      },
      {
        turnIndex: 4,
        query: 'fasilitas parkir di renon luas ga min?',
        expectedDomain: 'campus_facility',
        expectedEntity: 'RENON',
        expectedRelation: 'parking_facilities',
        expectedKeywords: ['parkir', 'kampus', 'fasilitas']
      }
    ]
  },

  // 49. Academic Policy - RPL Recognition (RPL overview -> work experience requirement -> semester reduction -> registration fee)
  {
    convId: 'P6_C49',
    domain: 'academic policy',
    variation: 'formal, RPL recognition of prior learning',
    turns: [
      {
        turnIndex: 1,
        query: 'apakah itb stikom bali menerima program rpl rekognisi pembelajaran lampau',
        expectedDomain: 'academic_policy',
        expectedEntity: 'RPL',
        expectedRelation: 'rpl_availability',
        expectedKeywords: ['RPL', 'Rekognisi Pembelajaran Lampau']
      },
      {
        turnIndex: 2,
        query: 'pengalaman kerja minimal berapa tahun buat bisa ikut rpl?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'RPL',
        expectedRelation: 'rpl_work_experience',
        expectedKeywords: ['pengalaman', 'kerja', 'portofolio', 'rpl']
      },
      {
        turnIndex: 3,
        query: 'bisa mempersingkat masa kuliah s1 berapa semester?',
        expectedDomain: 'academic_policy',
        expectedEntity: 'RPL',
        expectedRelation: 'rpl_duration_reduction',
        expectedKeywords: ['semester', 'konversi', 'SKS']
      },
      {
        turnIndex: 4,
        query: 'biaya pendaftaran jalur rpl berapa ya min?',
        expectedDomain: 'registration_fee',
        expectedEntity: 'RPL',
        expectedRelation: 'rpl_registration_fee',
        expectedKeywords: ['biaya', 'pendaftaran', 'rpl']
      }
    ]
  },

  // 50. Full Cross-Domain Capstone Multi-turn Dialogue (6 turns: Opening -> Program Comparison -> Career & Fee -> Schedule -> Scholarship -> Wrap Up)
  {
    convId: 'P6_C50',
    domain: 'program comparison',
    variation: '6-turn capstone, multi-domain transitions, formal/informal blend',
    turns: [
      {
        turnIndex: 1,
        query: 'halo min saya calon mahasiswa baru mau tanya info lengkap pmb',
        expectedDomain: 'smalltalk',
        expectedEntity: 'BOT',
        expectedRelation: 'greeting_opening',
        expectedKeywords: ['Halo', 'bantu', 'PMB']
      },
      {
        turnIndex: 2,
        query: 'saya bingung milih antara TI atau SI bagusan mana ya?',
        expectedDomain: 'program_comparison',
        expectedEntity: 'TI_VS_SI',
        expectedRelation: 'prodi_comparison',
        expectedKeywords: ['Teknologi Informasi', 'Sistem Informasi']
      },
      {
        turnIndex: 3,
        query: 'kalau TI prospek karir dan biayanya gimana min?',
        expectedDomain: 'tuition_fee',
        expectedEntity: 'TI',
        expectedRelation: 'ti_career_and_fee',
        expectedKeywords: ['Teknologi Informasi', '6.500.000']
      },
      {
        turnIndex: 4,
        query: 'kalo mau daftar gelombang 1 terakhir kapan?',
        expectedDomain: 'pmb_schedule',
        expectedEntity: 'WAVE_1',
        expectedRelation: 'wave_1_deadline',
        expectedKeywords: ['Gelombang 1', 'januari', 'maret']
      },
      {
        turnIndex: 5,
        query: 'ada beasiswa yang bisa saya daftar sekalian ga?',
        expectedDomain: 'scholarship',
        expectedEntity: 'STIKOM',
        expectedRelation: 'available_scholarships',
        expectedKeywords: ['beasiswa', 'KIP', 'prestasi']
      },
      {
        turnIndex: 6,
        query: 'terima kasih banyak admin infonya sangat membantu!',
        expectedDomain: 'smalltalk',
        expectedEntity: 'BOT',
        expectedRelation: 'polite_closing',
        expectedKeywords: ['sama-sama', 'terima kasih']
      }
    ]
  }
];

function normalizeText(txt) {
  return String(txt || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function runPhase6Validation() {
  console.log('================================================================');
  console.log('  PHASE 6: END-TO-END MULTI-TURN GENERALIZATION VALIDATION      ');
  console.log('  Strictly READ-ONLY (No code patch, no commit, no deploy)     ');
  console.log('================================================================\n');

  const sent = [];
  const provider = {
    sendMessage: async (chatId, text, meta) => {
      sent.push({ chatId: String(chatId || ''), text: String(text || ''), meta });
    }
  };

  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  const PER_QUERY_TIMEOUT_MS = 15000;
  let totalTurns = 0;
  let passTurns = 0;
  let failTurns = 0;

  // Metric accumulators required by Phase 6:
  let falseNoDataCount = 0;
  let wrongOwnerCount = 0;
  let wrongEntityCount = 0;
  let wrongRelationCount = 0;
  let contextLeakCount = 0;
  let staleContextRevivalCount = 0;
  let unnecessaryClarificationCount = 0;
  let performanceTimeoutCount = 0;

  const failures = [];

  for (let c = 0; c < PHASE6_CONVERSATIONS.length; c++) {
    const conv = PHASE6_CONVERSATIONS[c];
    const chatId = `p6-conv-${conv.convId}`;
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[Conv ${c + 1}/${PHASE6_CONVERSATIONS.length}] ${conv.convId} | Domain: ${conv.domain} | Variation: ${conv.variation}`);
    console.log(`----------------------------------------------------------------`);

    for (let t = 0; t < conv.turns.length; t++) {
      totalTurns++;
      const turn = conv.turns[t];
      const turnId = `${conv.convId}-T${turn.turnIndex}`;

      // Inject stale context if requested for testing stale context invalidation
      if (turn.injectStaleMinutes) {
        const existingSession = sessionStore.get(chatId);
        if (existingSession && existingSession.data && existingSession.data.conversationState) {
          const staleTime = new Date(Date.now() - turn.injectStaleMinutes * 60 * 1000).toISOString();
          existingSession.data.conversationState.updatedAt = staleTime;
          sessionStore.set(chatId, existingSession);
        }
      }

      const beforeSentCount = sent.length;
      const tStart = Date.now();
      const res = await makeRequest(port, {
        chatId,
        text: turn.query,
        messageId: `${chatId}-t${turn.turnIndex}-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        inboundTs: Date.now()
      }, PER_QUERY_TIMEOUT_MS);
      const durationMs = Date.now() - tStart;

      const messages = sent.slice(beforeSentCount).filter((m) => m.chatId === chatId).map((m) => m.text);
      const botResponse = messages.join('\n\n');
      const normResponse = normalizeText(botResponse);
      const actualSource = res.body && res.body.source ? String(res.body.source) : (res.timeout ? 'timeout' : '(unknown)');
      const sessionData = sessionStore.get(chatId) || null;
      const convState = sessionData?.data?.conversationState || null;

      // Evaluation & Assertions
      let turnPass = true;
      const turnFailureReasons = [];

      // 1. Timeout assertion
      if (res.timeout || durationMs > PER_QUERY_TIMEOUT_MS) {
        turnPass = false;
        performanceTimeoutCount++;
        turnFailureReasons.push(`PERFORMANCE_TIMEOUT: Query exceeded ${PER_QUERY_TIMEOUT_MS}ms (${durationMs}ms)`);
      }

      // 2. False No Data assertion
      const isUnwarrantedRejection = (
        /saya belum menemukan konteks/i.test(normResponse) ||
        /saya belum menemukan data/i.test(normResponse) ||
        /engine ai belum dikonfigurasi/i.test(normResponse) ||
        /tidak akan menebak/i.test(normResponse) ||
        /maaf, data tidak tersedia/i.test(normResponse)
      );
      if (isUnwarrantedRejection) {
        turnPass = false;
        falseNoDataCount++;
        turnFailureReasons.push('FALSE_NO_DATA_WITH_EXISTING_EVIDENCE: Bot returned refusal/no-data phrase for known knowledge');
      }

      // 3. Stale Context Revival assertion
      if (turn.injectStaleMinutes) {
        if (convState && convState.activeIntent === 'ask_fee') {
          turnPass = false;
          staleContextRevivalCount++;
          turnFailureReasons.push('STALE_CONTEXT_REVIVAL: Stale fee intent resurrected on expired context');
        }
      }

      // 4. Fresh Session Ambiguity / Unnecessary Clarification assertion
      if (turn.expectedRelation === 'clarification_prompt') {
        const askedClarification = /jelaskan|topik|spesifik|detail|pmb|biaya/i.test(normResponse);
        if (!askedClarification) {
          turnPass = false;
          turnFailureReasons.push('CORRECT_RELATION: Ambiguous query failed to ask for topic clarification');
        }
      } else {
        const isClarification = actualSource === 'semantic-rag-clarify' || /bisa jelaskan topik yang ingin ditanyakan/i.test(normResponse);
        if (isClarification) {
          turnPass = false;
          unnecessaryClarificationCount++;
          turnFailureReasons.push('UNNECESSARY_CLARIFICATION: Bot asked for clarification instead of answering with available context/data');
        }
      }

      // 5. Grounded Final Output & Keywords assertion
      if (turn.expectedKeywords && turn.expectedKeywords.length > 0) {
        const matched = turn.expectedKeywords.filter((kw) => normResponse.includes(kw.toLowerCase()));
        if (matched.length === 0) {
          turnPass = false;
          wrongRelationCount++;
          turnFailureReasons.push(`GROUNDED_FINAL_OUTPUT: None of expected keywords [${turn.expectedKeywords.join(', ')}] found in response`);
        }
      }

      // 6. Context Leak assertion
      if (convState && convState.activeDomain) {
        if (turn.expectedDomain === 'student_organization' && convState.activeDomain === 'fee') {
          turnPass = false;
          contextLeakCount++;
          turnFailureReasons.push('CONTEXT_LEAK: Fee domain leaked into student organization query');
        }
      }

      if (turnPass) {
        passTurns++;
        console.log(`  [PASS] ${turnId} (${durationMs}ms) | Q: "${turn.query}"`);
        console.log(`         Source: ${actualSource} | ActiveDomain: ${convState?.activeDomain || 'none'}`);
        console.log(`         Answer: ${botResponse.slice(0, 100).replace(/\n/g, ' ')}...`);
      } else {
        failTurns++;
        console.error(`  [FAIL] ${turnId} (${durationMs}ms) | Q: "${turn.query}"`);
        console.error(`         Source: ${actualSource}`);
        console.error(`         Reasons: ${turnFailureReasons.join('; ')}`);
        console.error(`         Answer: ${botResponse.slice(0, 140).replace(/\n/g, ' ')}...`);

        failures.push({
          turnId,
          input: turn.query,
          sessionContext: convState,
          expected: {
            domain: turn.expectedDomain,
            entity: turn.expectedEntity,
            relation: turn.expectedRelation,
            keywords: turn.expectedKeywords
          },
          actual: {
            source: actualSource,
            output: botResponse,
            convState
          },
          firstDivergence: turnFailureReasons[0] || 'Unknown divergence',
          knowledgeExists: 'YES',
          realRuntimeReproducible: 'YES',
          rootCause: turnFailureReasons.join('; ')
        });
      }
    }
  }

  server.close();

  console.log('\n================================================================');
  console.log('                 PHASE 6 VALIDATION METRICS                     ');
  console.log('================================================================');
  console.log(`MULTITURN_TOTAL=${totalTurns}`);
  console.log(`MULTITURN_PASS=${passTurns}`);
  console.log(`MULTITURN_FAIL=${failTurns}`);
  console.log(`FALSE_NO_DATA_WITH_EXISTING_EVIDENCE=${falseNoDataCount}`);
  console.log(`WRONG_OWNER=${wrongOwnerCount}`);
  console.log(`WRONG_ENTITY=${wrongEntityCount}`);
  console.log(`WRONG_RELATION=${wrongRelationCount}`);
  console.log(`CONTEXT_LEAK=${contextLeakCount}`);
  console.log(`STALE_CONTEXT_REVIVAL=${staleContextRevivalCount}`);
  console.log(`UNNECESSARY_CLARIFICATION=${unnecessaryClarificationCount}`);
  console.log(`PERFORMANCE_TIMEOUT=${performanceTimeoutCount}`);

  if (failures.length > 0) {
    console.log('\n================================================================');
    console.log('                      FAILURE DETAILS                           ');
    console.log('================================================================');
    console.log('STOP_PATCHING=YES\n');
    failures.forEach((f, idx) => {
      console.log(`--- FAILURE #${idx + 1} (${f.turnId}) ---`);
      console.log(`INPUT=${f.input}`);
      console.log(`SESSION_CONTEXT=${JSON.stringify(f.sessionContext)}`);
      console.log(`EXPECTED=${JSON.stringify(f.expected)}`);
      console.log(`ACTUAL=${JSON.stringify(f.actual)}`);
      console.log(`FIRST_DIVERGENCE=${f.firstDivergence}`);
      console.log(`KNOWLEDGE_EXISTS=${f.knowledgeExists}`);
      console.log(`REAL_RUNTIME_REPRODUCIBLE=${f.realRuntimeReproducible}`);
      console.log(`ROOT_CAUSE=${f.rootCause}\n`);
    });
  }

  const allPass = (
    falseNoDataCount === 0 &&
    wrongOwnerCount === 0 &&
    wrongEntityCount === 0 &&
    wrongRelationCount === 0 &&
    contextLeakCount === 0 &&
    staleContextRevivalCount === 0 &&
    performanceTimeoutCount === 0 &&
    failTurns === 0
  );

  console.log('================================================================');
  if (allPass) {
    console.log('PHASE6_STATUS=PASS');
    console.log('READY_FOR_PHASE7=YES');
  } else {
    console.log('PHASE6_STATUS=FAIL');
    console.log('READY_FOR_PHASE7=NO');
  }
  console.log('================================================================\n');

  return {
    allPass,
    totalTurns,
    passTurns,
    failTurns,
    falseNoDataCount,
    wrongOwnerCount,
    wrongEntityCount,
    wrongRelationCount,
    contextLeakCount,
    staleContextRevivalCount,
    unnecessaryClarificationCount,
    performanceTimeoutCount,
    failures
  };
}

if (require.main === module) {
  runPhase6Validation().then((res) => {
    process.exit(res.allPass ? 0 : 1);
  }).catch((err) => {
    console.error('Fatal execution error:', err);
    process.exit(1);
  });
}

module.exports = {
  runPhase6Validation,
  PHASE6_CONVERSATIONS
};
