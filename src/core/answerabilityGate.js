'use strict';

/**
 * src/core/answerabilityGate.js
 * 
 * Greenfield Answerability Gate.
 * Evaluates whether retrieved & arbitrated evidence is sufficient to answer the SemanticFrame.
 * 
 * Invariants:
 * - contexts.length > 0 DOES NOT imply ANSWERABLE.
 * - If accepted evidence is empty -> UNKNOWN or ESCALATE.
 * - Does not invent facts.
 */

const { detectQueryLanguage } = require('../utils/languageDetector');

const ANSWERABILITY_STATUS = Object.freeze({
  ANSWERABLE: 'ANSWERABLE',
  PARTIAL: 'PARTIAL',
  UNKNOWN: 'UNKNOWN',
  CLARIFY: 'CLARIFY',
  ESCALATE: 'ESCALATE'
});

function evaluateAnswerability(semanticFrame, arbitratedEvidence = {}) {
  const { accepted = [], rejected = [] } = arbitratedEvidence;
  const isEn = semanticFrame?.language === 'en' || detectQueryLanguage(semanticFrame?.rawQuery) === 'en';

  // 1. If no accepted evidence exists -> must evaluate before any factual or recommendation shortcut
  if (!accepted || accepted.length === 0) {
    // Allow clarification without external RAG evidence ONLY when query is genuinely ambiguous or broad guidance without specific preference
    if (
      semanticFrame.intent === 'AMBIGUOUS_CLARIFICATION' ||
      semanticFrame.isAmbiguous ||
      semanticFrame.ambiguityLevel === 'HIGH'
    ) {
      return {
        status: ANSWERABILITY_STATUS.CLARIFY,
        reason: 'ambiguous_clarification_required',
        coveredAspects: [],
        missingAspects: []
      };
    }

    if (semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' || semanticFrame.intent === 'PROGRAM_RECOMMENDATION') {
      const { isBroadSchoolBackgroundWithoutSpecificPreference } = require('../engine/programFitReasoning');
      const isBroad = isBroadSchoolBackgroundWithoutSpecificPreference(semanticFrame.rawQuery || '', {
        canonical: semanticFrame
      });
      if (isBroad) {
        return {
          status: ANSWERABILITY_STATUS.CLARIFY,
          reason: 'broad_recommendation_clarification_required',
          coveredAspects: ['recommendation', 'program_fit'],
          missingAspects: []
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_recommendation_evidence',
        coveredAspects: [],
        missingAspects: ['recommendation', 'program_fit'],
        guidance: isEn
          ? 'I apologize, but verified official curriculum information regarding this interest could not be confirmed from our available records. Please consult campus admissions directly.'
          : 'Mohon maaf Kak, informasi kurikulum resmi untuk minat tersebut belum dapat dipastikan dari dokumen yang tersedia saat ini. Silakan berkonsultasi langsung dengan admisi PMB ITB STIKOM Bali ya.'
      };
    }

    // If user query represents a missed academic process or complaint -> ESCALATE to admin/academic staff
    if (semanticFrame.intent === 'MISSED_ACADEMIC_PROCESS' || semanticFrame.userState === 'LATE') {
      return {
        status: ANSWERABILITY_STATUS.ESCALATE,
        reason: 'missed_process_requires_staff_assistance',
        guidance: isEn
          ? 'Please contact the Academic Administration Bureau (BAAK) or your academic advisor regarding late enrollment/advising.'
          : 'Mohon hubungi bagian Bagian Akademik (BAAK) atau dosen wali untuk penanganan keterlambatan perwalian.'
      };
    }

    if (semanticFrame.domain === 'ORGANIZATION_UKM' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['student_organization', 'ukm'].includes(a)))) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_ukm_evidence',
        guidance: isEn
          ? 'Official information regarding the requested student club or activity has not been verified from the available campus records.'
          : 'Informasi resmi mengenai Unit Kegiatan Mahasiswa (UKM) atau kegiatan tersebut belum berhasil diverifikasi dari sumber resmi kampus yang tersedia saat ini.'
      };
    }

    if (semanticFrame.domain === 'TUITION_FEE' || (semanticFrame.aspects && semanticFrame.aspects.some(a => ['fee', 'tuition', 'dpp'].includes(a)))) {
      const isFacilityOrInfrastructure = semanticFrame.domain === 'FACILITIES' ||
        (semanticFrame.aspects && semanticFrame.aspects.some(a => ['facilities', 'campus_infrastructure'].includes(a))) ||
        (semanticFrame.entities && semanticFrame.entities.some(e => ['campus_facility', 'facility'].includes(e.family || e.type))) ||
        /\b(?:parkir|parking)\b/i.test(semanticFrame.rawQuery || '');
      if (isFacilityOrInfrastructure) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_facility_fee_evidence',
          guidance: isEn
            ? 'Official information regarding parking or facility fees is not listed in the available guidelines.'
            : 'Informasi resmi mengenai tarif atau biaya fasilitas tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_fee_evidence',
        guidance: isEn
          ? 'Official information regarding tuition fee details for that study program is not fully listed in the available guide.'
          : 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }

    // Privacy Policy & Student Personal Data Protection Inquiry Gap
    if (
      semanticFrame.intent === 'PRIVACY_POLICY_INQUIRY' ||
      (semanticFrame.aspects && semanticFrame.aspects.some(a => ['privacy_policy', 'data_protection', 'personal_data_confidentiality', 'data_sharing', 'third_party_data_sharing'].includes(a))) ||
      /\b(?:kebijakan\s+privasi|melindungi\s+data\s+pribadi|perlindungan\s+data\s+pribadi|kerahasiaan\s+data|data\s+mahasiswa\s+dibagikan)\b/i.test(semanticFrame.rawQuery || '')
    ) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap_privacy_policy',
        coveredAspects: [],
        missingAspects: ['privacy_policy', 'data_protection'],
        guidance: isEn
          ? 'Official documents regarding institutional privacy policies, personal data protection, or third-party data sharing terms are currently not available in our published campus records. For official privacy and data governance provisions, please contact the campus administration or secretariat directly.'
          : 'Informasi mengenai dokumen resmi kebijakan privasi (privacy policy), ketentuan perlindungan data pribadi, maupun mekanisme pembagian data mahasiswa ke pihak ketiga saat ini belum tercantum dalam dokumen publikasi kampus yang tersedia. Untuk memperoleh ketentuan resmi terkait tata kelola dan privasi data, silakan menghubungi unit administrasi atau Sekretariat ITB STIKOM Bali secara langsung.'
      };
    }

    // Check for private contact inquiries (e.g. personal WA/phone of rector, kaprodi)
    const isPrivateContact = /\b(nomor\s+pribadi|wa\s+pribadi|whatsapp\s+pribadi|nomor\s+hp|kontak\s+pribadi|private\s+contact|personal\s+number)\b/i.test(semanticFrame.rawQuery || '');
    if (isPrivateContact) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap',
        guidance: isEn
          ? 'We apologize, but personal contact numbers are not published in official guidelines. Please contact the official university offices or public relations.'
          : 'Mohon maaf, nomor kontak pribadi tidak dipublikasikan dalam panduan resmi. Silakan menghubungi saluran resmi kampus atau humas ITB STIKOM Bali.'
      };
    }

    // SKSS Scholarship Inquiry Check
    if (/\bskss\b/i.test(semanticFrame.rawQuery || '')) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap_skss_unrecognized',
        coveredAspects: [],
        missingAspects: ['skss_scholarship'],
        guidance: isEn
          ? 'Official information regarding the program or acronym "Beasiswa SKSS" is not recognized or listed in the available ITB STIKOM Bali scholarship guidelines (SOURCE_NOT_FOUND). The abbreviation "SKSS" is not officially defined in campus records. To confirm available scholarship programs and their requirements, please consult the Admissions Committee (PMB).'
          : 'Informasi resmi mengenai program atau singkatan "Beasiswa SKSS" belum tercantum dalam dokumen pedoman beasiswa resmi ITB STIKOM Bali yang tersedia (SOURCE_NOT_FOUND). Entitas atau singkatan "SKSS" tidak terdefinisi secara resmi dalam dokumen panduan kampus. Untuk kepastian program beasiswa, kepanjangan singkatan, maupun persyaratannya, calon mahasiswa diarahkan untuk mengonfirmasi langsung ke Bagian Admisi / Panitia PMB ITB STIKOM Bali.'
      };
    }

    // SION Portal Troubleshooting / Contact Gap Guidance
    if (
      (semanticFrame.aspects && semanticFrame.aspects.includes('sion_troubleshooting')) ||
      /\bsion\b/i.test(semanticFrame.rawQuery || '')
    ) {
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap_sion_troubleshooting',
        coveredAspects: [],
        missingAspects: ['sion_troubleshooting'],
        guidance: isEn
          ? 'Official technical troubleshooting steps or dedicated helpdesk details for the SION academic portal (Sistem Informasi Online) are not listed in the available documents. For SION login issues, password resets, or class schedule conflicts, please contact the Academic Administration Department (Direktorat Administrasi Akademik / BAAK) or your Academic Advisor (Dosen Wali) directly at ITB STIKOM Bali.'
          : 'Informasi teknis mengenai penanganan kendala portal akademik **SION (Sistem Informasi Online)** — seperti kendala login, lupa kata sandi, atau bentrok jadwal kuliah — belum tercantum secara rinci dalam dokumen resmi yang tersedia. Untuk pengurusan kendala SION, silakan menghubungi bagian **Direktorat Administrasi Akademik (BAAK)** atau **Dosen Wali** di kampus ITB STIKOM Bali.'
      };
    }

    // Default when no evidence proves the question
    if (
      semanticFrame.intent === 'CURRENT_ENROLLMENT_STATUS' ||
      semanticFrame.domain === 'PMB' ||
      semanticFrame.intent === 'ADMISSION_PROCEDURE' ||
      semanticFrame.intent === 'PROGRAM_PROCEDURE'
    ) {
      const entityLabel = (semanticFrame.entities && semanticFrame.entities[0]) ? (semanticFrame.entities[0].canonical || semanticFrame.entities[0]) : '';
      const isUtb = /utb/i.test(entityLabel);
      const entityDesc = isUtb ? 'Program Dual Degree UTB (S1 Bisnis Digital)' : (entityLabel ? `program ${entityLabel}` : '');
      const entityPart = entityDesc ? ` untuk ${entityDesc}` : '';
      const rawQ = String(semanticFrame.rawQuery || '').toLowerCase();

      if (/\b(?:kode\s+verifikasi|otp|salah\s+mengisi\s+data|ubah\s+pilihan|lupa\s+nomor\s+handphone|belum\s+mendapat\s+konfirmasi|error\s+saat\s+dikirim|formulir.*error|setelah\s+isi\s+formulir|kartu\s+peserta)\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'corpus_gap_pmb_technical_procedure',
          coveredAspects: [],
          missingAspects: ['pmb_technical_or_specific_req'],
          guidance: isEn
            ? 'Detailed technical troubleshooting steps for online registration forms (such as OTP verification codes, form submission errors, data corrections, or post-submission confirmation) are not listed in the available guidelines. Please contact the ITB STIKOM Bali PMB Admissions Committee directly via https://pmb.stikom-bali.ac.id or official campus hotline (0361) 244445 / 082277389999 for immediate assistance.'
            : 'Rincian teknis penanganan kendala formulir pendaftaran online (seperti kendala kode verifikasi/OTP, perbaikan salah isi data, konfirmasi pasca-pengisian formulir, atau kendala pengiriman formulir) belum tercantum secara rinci dalam dokumen panduan yang tersedia. Silakan menghubungi langsung layanan **Panitia PMB ITB STIKOM Bali** melalui portal resmi **https://pmb.stikom-bali.ac.id** atau telepon kampus **(0361) 244445** untuk bantuan verifikasi data pendaftaran Anda.'
        };
      }

      if (/\b(?:ktp|kk|kartu\s+keluarga)\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'corpus_gap_pmb_document_requirements',
          coveredAspects: [],
          missingAspects: ['requirements'],
          guidance: isEn
            ? 'Specific requirements regarding attaching KTP and Family Card (KK) for domestic new student registration are not detailed in the available corpus documents. Please verify the required registration documents on the official admission portal https://pmb.stikom-bali.ac.id or contact PMB ITB STIKOM Bali.'
            : 'Rincian ketentuan wajib melampirkan berkas KTP dan Kartu Keluarga (KK) pada pendaftaran mahasiswa baru reguler belum tercantum secara spesifik dalam dokumen yang tersedia saat ini. Untuk daftar lengkap berkas persyaratan pendaftaran, silakan memeriksa langsung pada portal resmi **https://pmb.stikom-bali.ac.id** atau menghubungi bagian **Admisi PMB ITB STIKOM Bali**.'
        };
      }

      if (/\b(?:tes\s+masuk|ujian\s+seleksi|seleksi\s+tambahan|tes\s+tulis)\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'corpus_gap_pmb_entrance_test',
          coveredAspects: [],
          missingAspects: ['procedure'],
          guidance: isEn
            ? 'Detailed provisions regarding entrance tests or additional selection stages for new student admissions are not specified in the available documents. Please check the official admission portal https://pmb.stikom-bali.ac.id or contact the PMB Admissions Office at ITB STIKOM Bali.'
            : 'Informasi rinci mengenai mekanisme tes masuk atau tahapan seleksi tambahan pada Penerimaan Mahasiswa Baru (PMB) belum tercantum secara lengkap dalam dokumen yang tersedia. Silakan memeriksa informasi seleksi pada portal resmi **https://pmb.stikom-bali.ac.id** atau berkonsultasi langsung dengan bagian **Admisi PMB ITB STIKOM Bali**.'
        };
      }

      if (/\b(?:paket\s+c|kesetaraan)\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'corpus_gap_pmb_paket_c_eligibility',
          coveredAspects: [],
          missingAspects: ['admission_requirements', 'eligibility'],
          guidance: isEn
            ? 'Official admissions guidelines currently do not explicitly detail eligibility requirements for Paket C equivalency graduates. Please consult the ITB STIKOM Bali PMB Admissions Office directly via https://pmb.stikom-bali.ac.id or (0361) 244445 for certificate verification.'
            : 'Informasi resmi mengenai ketentuan persyaratan pendaftaran bagi lulusan **Paket C** (kesetaraan) belum tercantum secara eksplisit dalam dokumen panduan PMB yang tersedia saat ini. Silakan berkonsultasi langsung dengan bagian **Admisi PMB ITB STIKOM Bali** melalui portal resmi **https://pmb.stikom-bali.ac.id** atau narahubung kampus untuk verifikasi kesetaraan dan persyaratan berkas ya.'
        };
      }

      if (/\b(?:lebih\s+dari\s+satu|dua|beberapa)\s+(?:prodi|program\s+studi|jurusan)\b/i.test(rawQ) ||
          /\b(?:satu\s+orang\s+boleh\s+(?:memilih|pilih)|boleh(?:kah)?\s+(?:memilih|pilih)\s+(?:lebih\s+dari\s+satu|dua|beberapa))\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'corpus_gap_pmb_multi_program_choice',
          coveredAspects: [],
          missingAspects: ['program_selection_policy'],
          guidance: isEn
            ? 'Official admissions guidelines currently do not explicitly specify whether an applicant can select more than one study program in a single registration. Please verify the study program selection policy directly with the ITB STIKOM Bali PMB Admissions Office via https://pmb.stikom-bali.ac.id.'
            : 'Ketentuan resmi mengenai pemilihan lebih dari satu program studi dalam satu pendaftaran PMB belum tercantum secara eksplisit dalam dokumen resmi yang tersedia. Silakan konfirmasi langsung ke bagian **Admisi PMB ITB STIKOM Bali** melalui portal resmi **https://pmb.stikom-bali.ac.id** untuk mekanisme pilihan program studi ya.'
        };
      }

      if (/\b(?:menerima|buka|terima)\s+(?:mahasiswa\s+baru|pendaftaran)\s+tahun\s+ini\b/i.test(rawQ) ||
          /\bkampus\s+ini\s+menerima\s+mahasiswa\s+baru\s+tahun\s+ini\b/i.test(rawQ)) {
        const { extractAcademicYearFromEvidence } = require('./groundedAnswerGenerator');
        const detectedAy = extractAcademicYearFromEvidence(accepted, null);
        if (detectedAy) {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects: ['academic_year'],
            missingAspects: ['active_wave_schedule'],
            guidance: isEn
              ? `Based on official admission publications of ITB STIKOM Bali, admission is intended for Academic Year ${detectedAy}. However, the current active registration wave status and exact schedule cutoffs are not confirmed in available records. Please check https://pmb.stikom-bali.ac.id or contact the PMB committee.`
              : `Berdasarkan dokumen resmi Penerimaan Mahasiswa Baru (PMB) ITB STIKOM Bali, materi publikasi admisi yang tercatat ditujukan untuk **Tahun Akademik ${detectedAy}**. Namun, kepastian status pendaftaran yang sedang aktif (apakah saat ini sedang dibuka gelombang tertentu beserta jadwal tanggal pendaftarannya) belum tercantum dalam dokumen indeks yang tersedia. Untuk memastikan status gelombang pendaftaran yang sedang berjalan saat ini, persyaratan berkas, serta pendaftaran online, calon mahasiswa disarankan langsung mengakses portal resmi PMB di https://pmb.stikom-bali.ac.id atau menghubungi Panitia PMB ITB STIKOM Bali.`
          };
        } else {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects: [],
            missingAspects: ['academic_year', 'active_wave_schedule'],
            guidance: isEn
              ? 'Based on available official records, confirmation of active new student admission intake is not confirmed in the available documents. Please check https://pmb.stikom-bali.ac.id or contact the PMB committee.'
              : 'Berdasarkan dokumen resmi yang tersedia, kepastian penerimaan mahasiswa baru beserta jadwal pendaftaran yang sedang aktif belum tercantum dalam dokumen indeks yang tersedia. Untuk memastikan status pendaftaran, persyaratan berkas, serta pendaftaran online, calon mahasiswa disarankan langsung mengakses portal resmi PMB di https://pmb.stikom-bali.ac.id atau menghubungi Panitia PMB ITB STIKOM Bali.'
          };
        }
      }

      const { getCalendarSummaryFromEvidence } = require('./groundedAnswerGenerator');
      const calSummary = getCalendarSummaryFromEvidence(accepted);
      const hasHistoricalCalendar = calSummary !== null && calSummary.finalRegDeadline !== null;

      if (
        semanticFrame.intent === 'CURRENT_ENROLLMENT_STATUS' ||
        /\b(?:sekarang\s+buka\s+gelombang|gelombang\s+berapa\s+(?:sekarang|saat\s*ini)|apakah\s+(?:sekarang|saat\s*ini|masih)\s+buka\s+gelombang|apakah\s+(?:pendaftaran(?:\s+[a-z0-9]+)*\s+)?(?:masih|sudah)\s+dibuka|masih\s+bisa\s+daftar\s+hari\s+ini|daftar\s+hari\s+ini|status\s+pendaftaran|pendaftaran\s+itb\s+stikom\s+apakah\s+masih\s+dibuka)\b/i.test(rawQ)
      ) {
        if (hasHistoricalCalendar) {
          const ay = calSummary.academicYear ? `Tahun Akademik ${calSummary.academicYear}` : 'arsip PMB';
          const reRegStr = calSummary.finalReRegDeadline ? ` (dengan batas akhir registrasi ulang pada ${calSummary.finalReRegDeadline})` : '';
          const partialNotice = !calSummary.isComplete15Waves
            ? ` (Catatan: arsip dokumen yang ditemukan mencakup ${calSummary.totalWavesFound} gelombang dan tidak dapat digunakan untuk menyimpulkan status seluruh gelombang PMB)`
            : '';
          if (!calSummary.isComplete15Waves) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['live_active_wave'],
              guidance: isEn
                ? `Based on the official Admissions Calendar (Kalender Pendaftaran) for ITB STIKOM Bali ${ay}, the available records only cover partial waves (${calSummary.totalWavesFound} waves, from Gelombang ${calSummary.firstWave.label} to Gelombang ${calSummary.lastWave.label}). Because the available documents do not contain the full calendar across all intake waves, whether all registration waves have closed cannot be concluded from the available evidence. Please visit the official PMB portal at https://pmb.stikom-bali.ac.id or contact admissions at (0361) 244445 to verify current enrollment status.`
                : `Berdasarkan dokumen Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} yang ditemukan, data yang tersedia hanya memuat sebagian gelombang (${calSummary.totalWavesFound} gelombang, yaitu Gelombang ${calSummary.firstWave.label} hingga Gelombang ${calSummary.lastWave.label}). Karena dokumen bukti tidak memuat seluruh gelombang pendaftaran PMB secara lengkap, status penutupan seluruh gelombang PMB tidak dapat disimpulkan dari bukti yang ada. Calon mahasiswa disarankan memantau langsung portal resmi PMB di **https://pmb.stikom-bali.ac.id** atau menghubungi Panitia PMB di (0361) 244445 untuk memastikan pembukaan gelombang pendaftaran saat ini.`
            };
          } else if (calSummary.isHistorical) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['live_active_wave'],
              guidance: isEn
                ? `Based on the official Admissions Calendar (Kalender Pendaftaran) for ITB STIKOM Bali ${ay} (historical archive records — all dates have passed and do not represent upcoming intake dates), all 15 admission intake waves concluded registration on ${calSummary.finalRegDeadline}${reRegStr}. Currently, the official schedule and opening dates for the upcoming intake / academic year have not been confirmed in the available records. To verify whether registration has reopened or to check the upcoming schedule, please visit the official PMB portal at https://pmb.stikom-bali.ac.id or contact admissions at (0361) 244445.`
                : `Berdasarkan arsip resmi Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} (catatan arsip/historis — seluruh tanggal pendaftaran telah berlalu dan bukan jadwal seleksi yang akan datang), seluruh rangkaian 15 gelombang pendaftaran yang tercatat (mulai Gelombang ${calSummary.firstWave.label} hingga Gelombang ${calSummary.lastWave.label}) telah ditutup pada **${calSummary.finalRegDeadline}**${reRegStr}.\n\nSaat ini, kepastian jadwal pembukaan pendaftaran untuk periode/intake berikutnya belum tercantum dalam dokumen resmi yang tersedia. Untuk memastikan pembaruan jadwal atau pembukaan gelombang berikutnya, calon mahasiswa disarankan memantau langsung portal resmi PMB di **https://pmb.stikom-bali.ac.id** atau menghubungi Panitia PMB di (0361) 244445.`
            };
          } else if (calSummary.isUpcoming) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['live_active_wave'],
              guidance: isEn
                ? `Based on the official Admissions Calendar for ITB STIKOM Bali ${ay} (upcoming admissions schedule), registration has not started yet and is scheduled to open starting with Gelombang ${calSummary.firstWave.label} on ${calSummary.initialRegStartDate || 'the scheduled date'}.${partialNotice} Registration is not open today.`
                : `Berdasarkan Kalender Pendaftaran resmi PMB ITB STIKOM Bali ${ay} (jadwal pendaftaran mendatang), pendaftaran mahasiswa baru saat ini belum dimulai dan dijadwalkan akan dibuka mulai Gelombang ${calSummary.firstWave.label} pada **${calSummary.initialRegStartDate || 'tanggal yang ditetapkan'}**.${partialNotice}\n\nPendaftaran belum dibuka hari ini. Silakan memantau portal resmi di **https://pmb.stikom-bali.ac.id**.`
            };
          }
        }
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'admission_schedule_unconfirmed',
          coveredAspects: [],
          missingAspects: ['live_active_wave', 'admission_calendar'],
          guidance: isEn
            ? 'Official information regarding current registration wave status is not confirmed in the available guidelines. Please visit the official PMB portal at https://pmb.stikom-bali.ac.id or contact admissions at (0361) 244445.'
            : 'Informasi resmi mengenai status gelombang pendaftaran yang sedang berjalan saat ini belum dapat dipastikan dari dokumen yang tersedia. Silakan langsung memeriksa portal resmi PMB di **https://pmb.stikom-bali.ac.id** atau menghubungi Panitia PMB di (0361) 244445.'
        };
      }

      if (/\b(?:minggu\s+depan|masih\s+sempat|masih\s+bisa\s+daftar\s+minggu\s+depan|apakah\s+masih\s+sempat)\b/i.test(rawQ)) {
        if (hasHistoricalCalendar) {
          const ay = calSummary.academicYear ? `Tahun Akademik ${calSummary.academicYear}` : 'arsip PMB';
          if (!calSummary.isComplete15Waves) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['registration_deadline'],
              guidance: isEn
                ? `Based on the admissions calendar documents found for ITB STIKOM Bali ${ay}, the available records only cover partial waves (${calSummary.totalWavesFound} waves). Because the records do not cover all intake waves, the final registration deadline across all waves cannot be confirmed. Please check https://pmb.stikom-bali.ac.id.`
                : `Berdasarkan dokumen Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} yang ditemukan, data yang tersedia hanya memuat sebagian gelombang (${calSummary.totalWavesFound} gelombang). Karena dokumen tidak memuat seluruh gelombang pendaftaran secara lengkap, batas akhir pendaftaran untuk seluruh gelombang belum dapat dipastikan dari bukti yang ada. Silakan langsung memeriksa portal https://pmb.stikom-bali.ac.id.`
            };
          }
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects: ['admission_calendar'],
            missingAspects: ['registration_deadline'],
            guidance: isEn
              ? `Based on the official Admissions Calendar (Kalender Pendaftaran) for ITB STIKOM Bali ${ay} (historical archive records), all recorded intake waves concluded registration on ${calSummary.finalRegDeadline} and opening dates for the upcoming intake are not confirmed in the records, so whether registration is still open next week cannot be confirmed. Please check https://pmb.stikom-bali.ac.id.`
              : `Berdasarkan arsip resmi Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} (catatan arsip/historis), seluruh gelombang pendaftaran yang tercatat telah berakhir pada **${calSummary.finalRegDeadline}** dan jadwal gelombang pendaftaran berikutnya belum tercantum dalam dokumen, sehingga kepastian apakah pendaftaran masih dibuka pada minggu depan belum dapat dipastikan. Silakan langsung memeriksa portal https://pmb.stikom-bali.ac.id.`
          };
        }
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'admission_schedule_unconfirmed',
          coveredAspects: [],
          missingAspects: ['registration_deadline'],
          guidance: isEn
            ? 'Based on available official documents, the exact deadline date for the current registration intake wave is not specified. To confirm whether registration is still open at that time, please consult the official admission portal at https://pmb.stikom-bali.ac.id.'
            : 'Berdasarkan dokumen resmi yang tersedia, kepastian batas akhir tanggal pendaftaran gelombang saat ini belum tercantum. Untuk memastikan apakah pendaftaran masih dibuka pada waktu tersebut, silakan langsung memeriksa portal https://pmb.stikom-bali.ac.id.'
        };
      }

      if (/\b(?:coding|koding|ngoding|pemrograman|programming)\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'corpus_gap_coding_requirement',
          coveredAspects: [],
          missingAspects: ['requirements', 'coding_prerequisite'],
          guidance: isEn
            ? 'The available official PMB guidelines of ITB STIKOM Bali do not currently contain sufficient information to confirm whether prior coding or programming skills are required before enrolling. To confirm selection details or technical study program prerequisites, please consult the admissions committee directly via https://pmb.stikom-bali.ac.id.'
            : 'Dokumen resmi panduan PMB ITB STIKOM Bali yang tersedia saat ini belum memuat informasi yang cukup untuk memastikan apakah terdapat persyaratan kemampuan coding atau penguasaan pemrograman sebelum mendaftar. Untuk memastikan rincian materi seleksi atau prasyarat teknis program studi, silakan berkonsultasi langsung dengan Panitia PMB melalui portal https://pmb.stikom-bali.ac.id.'
        };
      }

      const isGeneralRegistrationProcedure = (
        semanticFrame.intent === 'ADMISSION_PROCEDURE' ||
        semanticFrame.intent === 'GENERAL_PMB_INQUIRY' ||
        /\b(?:cara\s+daftar|alur\s+pendaftaran|prosedur\s+pendaftaran|tahapan\s+daftar|(?:mau|mw|pengen|ingin|bisa)\s+daftar|mulai\s+dari\s+mana)\b/i.test(rawQ)
      ) && !/\b(?:tes|ujian|otp|verifikasi|salah\s+mengisi|paket\s+c|ktp|kk)\b/i.test(rawQ);

      if (isGeneralRegistrationProcedure) {
        return {
          status: ANSWERABILITY_STATUS.ANSWERABLE,
          reason: 'general_pmb_registration_procedure_supported',
          coveredAspects: ['procedure', 'registration_portal', 'admission_overview'],
          missingAspects: []
        };
      }

      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'corpus_gap',
        guidance: isEn
          ? `Official detailed registration steps${entityPart} are not fully listed in the available guidelines. Registration can be accessed online at https://pmb.stikom-bali.ac.id or by contacting campus admissions directly.`
          : `Tahapan prosedur pendaftaran rinci${entityPart} belum tercantum lengkap dalam panduan yang tersedia. Pendaftaran resmi dapat diakses secara online melalui portal https://pmb.stikom-bali.ac.id atau berkonsultasi langsung ke layanan admisi kampus ITB STIKOM Bali.`
      };
    }

    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap',
      guidance: isEn
        ? 'Official information regarding this matter is not fully listed in the available guidelines.'
        : 'Informasi resmi terkait hal ini belum tercantum secara lengkap dalam panduan yang tersedia.'
    };
  }

  // Institutional Academic Program Recommendation Reasoning when RAG evidence is present
  if (semanticFrame.domain === 'ACADEMIC_RECOMMENDATION' || semanticFrame.intent === 'PROGRAM_RECOMMENDATION') {
    return {
      status: ANSWERABILITY_STATUS.ANSWERABLE,
      reason: 'supported_recommendation_evidence',
      coveredAspects: ['recommendation', 'program_fit'],
      missingAspects: []
    };
  }

  // 2. Verification of Specific Uncataloged Topic Grounding:
  // If query asks for specific uncataloged topics (private contact, parking fees, canteen menu, shuttle bus),
  // the accepted evidence must explicitly mention the specific inquiry topic, rather than generic campus FAQ.
  const rawQ = String(semanticFrame.rawQuery || '').toLowerCase();
  const isPrivateContact = /\b(?:nomor\s+)?(?:wa|whatsapp|hp|handphone|telepon|telp|kontak)\s+pribadi\b|\b(?:nomor\s+pribadi|kontak\s+pribadi)\b/i.test(rawQ);
  const isParkingFee = /\b(parkir(?:\s+inap)?|tarif\s+parkir|parking|parking\s+(?:fee|rate|subscription))\b/i.test(rawQ);
  const isCanteenMenu = /\b(kantin|menu\s+makanan|katering)\b/i.test(rawQ);
  const isShuttleBus = /\b(bus\s+shuttle|shuttle\s+bus)\b/i.test(rawQ);
  const isSpecificExternalScholarship = /\b(pemda|pemerintah\s+daerah|provinsi\s+papua|beasiswa\s+pemda)\b/i.test(rawQ);

  const combinedEvidenceText = accepted.map(c => c.text || c.chunk || '').join(' ').toLowerCase();

  if (/\bskss\b/i.test(rawQ)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_skss_unrecognized',
      coveredAspects: [],
      missingAspects: ['skss_scholarship'],
      guidance: isEn
        ? 'Official information regarding the program or acronym "Beasiswa SKSS" is not recognized or listed in the available ITB STIKOM Bali scholarship guidelines (SOURCE_NOT_FOUND). The abbreviation "SKSS" is not officially defined in campus records. To confirm available scholarship programs and their requirements, please consult the Admissions Committee (PMB).'
        : 'Informasi resmi mengenai program atau singkatan "Beasiswa SKSS" belum tercantum dalam dokumen pedoman beasiswa resmi ITB STIKOM Bali yang tersedia (SOURCE_NOT_FOUND). Entitas atau singkatan "SKSS" tidak terdefinisi secara resmi dalam dokumen panduan kampus. Untuk kepastian program beasiswa, kepanjangan singkatan, maupun persyaratannya, calon mahasiswa diarahkan untuk mengonfirmasi langsung ke Bagian Admisi / Panitia PMB ITB STIKOM Bali.'
    };
  }

  if (isPrivateContact && !/\b(?:nomor|kontak|wa|hp)\s+pribadi\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_private_contact_not_published',
      coveredAspects: [],
      missingAspects: ['private_contact'],
      guidance: 'Mohon maaf, nomor kontak pribadi tidak tercantum dalam panduan resmi yang tersedia. Silakan menghubungi saluran kontak resmi kampus.'
    };
  }

  if (isParkingFee && !/\b(parkir|tarif\s+parkir|parking)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_parking_fee_unrecorded',
      coveredAspects: [],
      missingAspects: ['parking_fee'],
      guidance: isEn
        ? 'Official information regarding annual student car parking subscriptions is currently not listed in the available campus guidelines. Please confirm directly with campus administration.'
        : 'Informasi resmi mengenai tarif parkir inap kendaraan belum tercantum secara lengkap dalam panduan yang tersedia.'
    };
  }

  if (isCanteenMenu && !/\b(kantin|menu|katering)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_canteen_menu_unrecorded',
      coveredAspects: [],
      missingAspects: ['canteen_menu'],
      guidance: 'Informasi mengenai menu makanan dan tarif katering kantin belum tercantum dalam dokumen resmi yang tersedia.'
    };
  }

  if (isShuttleBus && !/\b(shuttle|bus\s+shuttle)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_shuttle_bus_unrecorded',
      coveredAspects: [],
      missingAspects: ['shuttle_schedule'],
      guidance: 'Jadwal dan informasi bus shuttle antar kampus belum tercantum dalam panduan resmi yang tersedia.'
    };
  }

  if (isSpecificExternalScholarship && !/\b(papua|pemda)\b/i.test(combinedEvidenceText)) {
    return {
      status: ANSWERABILITY_STATUS.UNKNOWN,
      reason: 'corpus_gap_external_scholarship_unrecorded',
      coveredAspects: [],
      missingAspects: ['regional_scholarship'],
      guidance: 'Informasi resmi terkait program beasiswa khusus dari Pemerintah Daerah tersebut belum tercantum dalam dokumen resmi yang tersedia.'
    };
  }

  // 3. Aspect Coverage Verification:
  let requiredAspects = (semanticFrame.aspects || []).filter(a => a !== 'general');
  if (semanticFrame.intent === 'ORGANIZATION_MEMBERSHIP_CHECK') {
    // In membership verification, the category aspect being questioned is the hypothesis under test, not an evidence requirement
    requiredAspects = requiredAspects.filter(a => !['arts_culture', 'sports', 'reasoning_tech', 'religious'].includes(a));
  }
  if (/\b(?:apa\s+saja|ada\s+apa(?:\s+saja)?|daftar|jenis(?:-jenis)?)\b/i.test(rawQ) && /\bbeasiswa\b/i.test(rawQ)) {
    if (!requiredAspects.includes('scholarship_list')) {
      requiredAspects.push('scholarship_list');
    }
  }
  if (requiredAspects.length > 0) {
    const allProvidedAspects = new Set();
    for (const chunk of accepted) {
      if (Array.isArray(chunk.providedAspects)) {
        chunk.providedAspects.forEach(a => allProvidedAspects.add(a));
      }
      const text = (chunk.text || chunk.chunk || '').toLowerCase();
      if (/\b(?:rpl|rekognisi\s+pembelajaran\s+lampau)\b/i.test(text)) {
        allProvidedAspects.add('rpl');
      }
      if (/\b(?:transfer\s+(?:sks|kredit)|perolehan\s+(?:sks|kredit)|konversi\s+(?:sks|nilai)|asesmen)\b/i.test(text)) {
        allProvidedAspects.add('credit_transfer');
        allProvidedAspects.add('assessment');
        allProvidedAspects.add('work_experience');
      }
      if (/\b(?:formulir\s+aplikasi|f01|form\s+1|riwayat\s+pengalaman\s+kerja|evaluasi\s+diri)\b/i.test(text)) {
        allProvidedAspects.add('rpl_form');
        allProvidedAspects.add('form_procedure');
        allProvidedAspects.add('form_filling');
        allProvidedAspects.add('procedure');
      }
      if (/\b(?:v-?a-?t-?m|sahih|otentik|terkini|memadai|portofolio)\b/i.test(text)) {
        allProvidedAspects.add('requirements');
        allProvidedAspects.add('documents');
        allProvidedAspects.add('portfolio');
      }
      if (/\b(?:alur\s+prosedur|tahapan|pendaftaran\s+online|pmb\.stikom-bali\.ac\.id)\b/i.test(text)) {
        allProvidedAspects.add('admission_stages');
        allProvidedAspects.add('procedure');
        allProvidedAspects.add('registration');
      }
      if (/\b(?:3\.000\.000|4\.500\.000|5\.000\.000|7\.000\.000|dpp|dana\s+pendidikan\s+pokok)\b/i.test(text) && /\b(?:rpl|rekognisi|pengakuan\s+sks)\b/i.test(text)) {
        allProvidedAspects.add('rpl_fee');
        allProvidedAspects.add('fee');
        allProvidedAspects.add('dpp');
        allProvidedAspects.add('tuition');
      }
      if (/\b(?:alur\s+pendaftaran|prosedur\s+pendaftaran|tahapan\s+pendaftaran|langkah(?:-langkah)?\s+pendaftaran|tata\s+cara\s+(?:daftar|mendaftar|pendaftaran)|mekanisme\s+pendaftaran)\b/i.test(text)) {
        allProvidedAspects.add('procedure');
        allProvidedAspects.add('admission');
      }
      if (/\b(?:pmb\.stikom-bali\.ac\.id|portal\s+pmb|link\s+pendaftaran)\b/i.test(text)) {
        allProvidedAspects.add('admission_portal');
        allProvidedAspects.add('portal');
      }
      if (/\b(?:syarat\s+pendaftaran|persyaratan\s+pendaftaran|berkas\s+pendaftaran|kelengkapan\s+dokumen|ijazah|fotokopi|dokumen\s+persyaratan)\b/i.test(text)) {
        allProvidedAspects.add('requirements');
      }
      if (/\b(?:kebijakan\s+mutu|standar\s+mutu|mutu\s+institusi)\b/i.test(text)) {
        allProvidedAspects.add('quality_policy');
        allProvidedAspects.add('institutional_quality');
      }
      if (/\b(?:manfaat|keuntungan|benefit|tujuan|kelebihan|peluang)\b/i.test(text)) {
        allProvidedAspects.add('benefits');
      }
      if (/\b(?:gelar|sarjana|diploma|degree|s\.kom|s\.bns|s\.ds|s\.ti|m\.kom|a\.md)\b/i.test(text)) {
        allProvidedAspects.add('degree_award');
      }
      if (/\b(?:jalan\s+raya\s+puputan|renon|kampus\s+renon|raya\s+kampus\s+udayana|kampus\s+jimbaran|abiansemal|kampus\s+abiansemal|dauh\s+yeh\s+cani)\b/i.test(text) && /(?:\bjl\.?|\bjalan\b|\balamat\b|\blokasi\b)/i.test(text)) {
        allProvidedAspects.add('location');
        allProvidedAspects.add('campus_location');
        allProvidedAspects.add('address');
        if (/\b(?:renon|puputan)\b/i.test(text)) allProvidedAspects.add('branch_renon');
        if (/\b(?:jimbaran|udayana)\b/i.test(text)) allProvidedAspects.add('branch_jimbaran');
        if (/\b(?:abiansemal|janger|dauh\s+yeh\s+cani)\b/i.test(text)) allProvidedAspects.add('branch_abiansemal');
      }
      if (/\b(?:laboratorium|lab\b|perpustakaan|asrama|sarana|prasarana|ruang\s+kelas|gedung\s+kampus|fasilitas)\b/i.test(text)) {
        allProvidedAspects.add('facilities');
        allProvidedAspects.add('campus_infrastructure');
        allProvidedAspects.add('lab');
      }
      if (/\b(?:karir|karier|kerja|loker|lowongan|magang|pelatihan|cv|wawancara|alumni|rekrutmen|profesi|pekerjaan)\b/i.test(text)) {
        allProvidedAspects.add('career_services');
        allProvidedAspects.add('career');
        allProvidedAspects.add('career_prospects');
      }
      if (/\b(?:sertifikasi|sertifikat|kompetensi|kursus|learning)\b/i.test(text)) {
        allProvidedAspects.add('certification');
      }
      if (/\b(?:pelatihan|training|optimalisasi|pembekalan|workshop)\b/i.test(text)) {
        allProvidedAspects.add('training');
      }
      if (/\b(?:kerja\s*sama|kerjasama|mitra|industri|perusahaan)\b/i.test(text)) {
        allProvidedAspects.add('cooperation');
      }
      if (/\b(?:magang|internship|praktik\s+kerja)\b/i.test(text)) {
        allProvidedAspects.add('internship');
      }
      if (/\b(?:layanan|program|informasi|kegiatan|cdc|center|stikom|kampus|pelatihan|kursus)\b/i.test(text)) {
        allProvidedAspects.add('service_info');
        allProvidedAspects.add('program_info');
        allProvidedAspects.add('support');
        allProvidedAspects.add('services');
      }
      if (/\b(?:sion|sistem\s+informasi\s+online|e-learning|sid\b|portal\s+akademik)\b/i.test(text)) {
        allProvidedAspects.add('academic_system');
        allProvidedAspects.add('services');
      }
      if (/\b(?:ts_dirkka@stikom-bali\.ac\.id|direktur\s+kemahasiswaan,\s*karir\s+dan\s+alumni|direktorat\s+kemahasiswaan|wakil\s+rektor\s+iii)\b/i.test(text)) {
        allProvidedAspects.add('student_affairs');
        allProvidedAspects.add('contact');
      }
      if (/\b(?:kurikulum|matkul|mata\s+kuliah|sks|semester|pembelajaran)\b/i.test(text)) {
        allProvidedAspects.add('curriculum');
        allProvidedAspects.add('course');
      }
      if (/\b(?:empat\s+pilar\s+riset|pilar\s+riset\s+utama|fokus\s+penelitian|fokus\s+keilmuan|data\s+science.*cyber\s+security|enterprise\s+system)\b/i.test(text)) {
        allProvidedAspects.add('research_focus');
        allProvidedAspects.add('curriculum');
      }
      if (/\b(?:d3|diploma|manajemen\s+informatika|vokasi|ahli\s+madya)\b/i.test(text)) {
        allProvidedAspects.add('vocational');
        allProvidedAspects.add('program_list');
        allProvidedAspects.add('degrees');
      }
      if (/\b(?:fakultas|informatika\s+dan\s+komputer|bisnis\s+dan\s+vokasi|fik|fbv)\b/i.test(text)) {
        allProvidedAspects.add('faculty');
        allProvidedAspects.add('academic_structure');
        allProvidedAspects.add('faculty_mapping');
      }
      if (/\b(?:ukm|organisasi|ormawa)\b/i.test(text)) {
        allProvidedAspects.add('membership');
        allProvidedAspects.add('category');
        allProvidedAspects.add('ukm_list');
        allProvidedAspects.add('student_organization');
        allProvidedAspects.add('ukm');
        if (/\b(?:rade|syntax|ksl|teknologi\s+dan\s+penalaran|robotik|linux)\b/i.test(text)) {
          allProvidedAspects.add('reasoning_tech');
        }
      }
      if (/\b(?:penerimaan\s+mahasiswa\s+baru|pmb|tahun\s+akademik|menerima\s+mahasiswa|buka\s+pendaftaran)\b/i.test(text)) {
        allProvidedAspects.add('academic_year');
        allProvidedAspects.add('admission_overview');
        const hasDateOrWave = /\b(?:gelombang\s+\d+|tahap\s+\d+|tanggal|\d{1,2}\s+(?:jan|feb|mar|apr|mei|jun|jul|ags|agu|sep|okt|nov|des))\b/i.test(text);
        if (hasDateOrWave) {
          allProvidedAspects.add('schedule');
          allProvidedAspects.add('status');
          allProvidedAspects.add('admission_status');
          allProvidedAspects.add('admission_schedule');
          allProvidedAspects.add('wave_info');
          allProvidedAspects.add('stages');
        }
      }
      if (/\b(?:gelombang|potongan|diskon|promo|cashback|periode)\b/i.test(text)) {
        allProvidedAspects.add('wave_discount');
        allProvidedAspects.add('discount');
        allProvidedAspects.add('admission_wave');
        allProvidedAspects.add('timeline');
      }
      if (/\b(?:biaya|uang\s+kuliah|tarif|spp)\b/i.test(text)) {
        allProvidedAspects.add('fee');
        allProvidedAspects.add('tuition');
      }
      if (/\b(?:rincian\s+biaya|komponen\s+biaya|struktur\s+biaya|skema\s+biaya|angsuran|tahap\s+pembayaran)\b/i.test(text)) {
        allProvidedAspects.add('fee_structure');
      }
      if (/\b(?:dpp\s+dan\s+spp|registrasi.*dpp|komponen\s+biaya|rincian\s+biaya|biaya\s+sks|biaya\s+praktikum)\b/i.test(text)) {
        allProvidedAspects.add('fee_components');
      }
      if (/\b(?:total\s+(?:biaya|kewajiban|keseluruhan|pembayaran)|jumlah\s+kewajiban|total\s+keseluruhan|biaya\s+total)\b/i.test(text)) {
        allProvidedAspects.add('total_cost');
      }
      if (/\b(?:beasiswa|kip\s*kuliah|kartu\s+indonesia\s+pintar|bantuan\s+dana\s+pendidikan)\b/i.test(text)) {
        allProvidedAspects.add('scholarship');
        allProvidedAspects.add('scholarship_types');
        if (/\b(?:daftar\s+beasiswa|jenis\s+beasiswa|beasiswa\s+berikut|antara\s+lain\s*:|yayasan|prestasi)\b/i.test(text)) {
          allProvidedAspects.add('scholarship_list');
        }
      }
      if (/\b(?:pmb|pendaftaran|jalur|syarat|prosedur|jadwal|gelombang|penerimaan)\b/i.test(text)) {
        allProvidedAspects.add('admission_overview');
        allProvidedAspects.add('admission_pathways');
      }
      if (/\b(?:syarat|persyaratan|berkas|ijazah|lulusan|kelayakan|eligibility|ketentuan)\b/i.test(text)) {
        allProvidedAspects.add('requirements');
        allProvidedAspects.add('admission_requirements');
        allProvidedAspects.add('eligibility');
      }
    }

    // Contact Aspect verification:
    // Only satisfy contact aspects if an accepted chunk contains contact/phone info
    const hasContactEvidence = accepted.some(chunk => {
      const text = (chunk.text || '').toLowerCase();
      return /\b(?:telepon|telp|hotline|email|\(0361\)|08\d{8,}|info@stikom-bali\.ac\.id|ts_dirkka@stikom-bali\.ac\.id|international_office@stikom-bali\.ac\.id)\b/i.test(text);
    });
    if (hasContactEvidence && !isPrivateContact) {
      allProvidedAspects.add('contact');
      allProvidedAspects.add('phone');
      allProvidedAspects.add('whatsapp');
    }

    // Campus Location Entity Coverage Evaluation:
    if (semanticFrame.intent === 'CAMPUS_LOCATION' || requiredAspects.some(a => ['location', 'campus_location', 'address'].includes(a))) {
      const isAllLocationsRequested = semanticFrame.locationScope === 'ALL' ||
        requiredAspects.includes('all_locations') ||
        semanticFrame.scope === 'ALL';
      const targetBranch = semanticFrame.targetBranch || null;

      const hasRenonEvidence = accepted.some(chunk => {
        const text = (chunk.text || '').toLowerCase();
        return /\b(?:kampus\s+renon|puputan|renon)\b/i.test(text) && /\b(?:jl\.|jalan|no\.|raya|denpasar)\b/i.test(text);
      });

      const hasJimbaranEvidence = accepted.some(chunk => {
        const text = (chunk.text || '').toLowerCase();
        const isUnivUdayanaOtherContext = /\buniversitas\s+udayana\b/i.test(text) && !/\b(?:kampus\s+jimbaran|(?:jl\.|jalan|raya)\s+kampus\s+udayana)\b/i.test(text);
        if (isUnivUdayanaOtherContext) return false;
        return (
          (/\b(?:kampus\s+jimbaran|kuta\s+selatan|jimbaran)\b/i.test(text) && /\b(?:udayana|raya\s+kampus|jl\.|jalan)\b/i.test(text)) ||
          /\b(?:jl\.|jalan|raya)\s+kampus\s+udayana\b/i.test(text)
        );
      });

      const hasAbiansemalEvidence = accepted.some(chunk => {
        const text = (chunk.text || '').toLowerCase();
        return /\b(?:kampus\s+abiansemal|abiansemal|dauh\s+yeh\s+cani)\b/i.test(text) && /\b(?:janger|jl\.|jalan|badung)\b/i.test(text);
      });

      const coveredBranches = [];
      const missingBranches = [];
      if (hasRenonEvidence) coveredBranches.push('Kampus Renon'); else missingBranches.push('Kampus Renon');
      if (hasJimbaranEvidence) coveredBranches.push('Kampus Jimbaran'); else missingBranches.push('Kampus Jimbaran');
      if (hasAbiansemalEvidence) coveredBranches.push('Kampus Abiansemal'); else missingBranches.push('Kampus Abiansemal');

      if (targetBranch) {
        const branchMap = { renon: hasRenonEvidence, jimbaran: hasJimbaranEvidence, abiansemal: hasAbiansemalEvidence };
        if (branchMap[targetBranch] === false) {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: `insufficient_${targetBranch}_location_evidence`,
            coveredAspects: [],
            missingAspects: [`${targetBranch}_campus_location`],
            guidance: isEn
              ? `Official address for ${targetBranch.toUpperCase()} campus is not confirmed in the available guidelines.`
              : `Informasi resmi mengenai alamat Kampus ${targetBranch.toUpperCase()} belum tercantum secara lengkap dalam panduan yang tersedia.`
          };
        }
      }

      if (isAllLocationsRequested) {
        if (coveredBranches.length === 3) {
          allProvidedAspects.add('all_locations');
          allProvidedAspects.add('location');
          allProvidedAspects.add('campus_location');
          allProvidedAspects.add('address');
        } else if (coveredBranches.length > 0) {
          return {
            status: ANSWERABILITY_STATUS.PARTIAL,
            reason: 'partial_campus_locations_coverage',
            coveredAspects: ['location', 'campus_location'],
            missingAspects: missingBranches,
            coveredBranches,
            missingBranches,
            guidance: isEn
              ? `Official location details are currently available for ${coveredBranches.join(' and ')}, while information for ${missingBranches.join(' and ')} is not fully verified in the available guidelines.`
              : `Informasi lokasi resmi saat ini baru memuat alamat untuk ${coveredBranches.join(' dan ')}, sedangkan rincian alamat resmi untuk ${missingBranches.join(' dan ')} belum tercantum secara lengkap dalam panduan yang tersedia.`
          };
        } else {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'insufficient_campus_locations_evidence',
            coveredAspects: [],
            missingAspects: requiredAspects,
            guidance: isEn
              ? 'Official campus locations are not confirmed in the available guidelines.'
              : 'Informasi mengenai lokasi kampus ITB STIKOM Bali belum tercantum dalam panduan resmi yang tersedia.'
          };
        }
      } else if (coveredBranches.length === 0) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_campus_location_evidence',
          coveredAspects: [],
          missingAspects: requiredAspects,
          guidance: isEn
            ? 'Official campus location information is not confirmed in the available guidelines.'
            : 'Informasi mengenai lokasi kampus ITB STIKOM Bali belum tercantum dalam panduan resmi yang tersedia.'
        };
      }
    }

    const coveredAspects = requiredAspects.filter(req => allProvidedAspects.has(req));
    const missingAspects = requiredAspects.filter(req => !allProvidedAspects.has(req));

    if (coveredAspects.length === 0) {
      if (
        (semanticFrame.domain === 'FACILITIES' || semanticFrame.intent === 'FACILITY_INQUIRY') &&
        semanticFrame.targetBranch &&
        ['jimbaran', 'abiansemal'].includes(semanticFrame.targetBranch)
      ) {
        const branchKey = 'branch_' + semanticFrame.targetBranch;
        const hasBranchEvidence = allProvidedAspects.has(branchKey) ||
          accepted.some(c => new RegExp(semanticFrame.targetBranch, 'i').test(c.text || c.chunk || ''));
        if (hasBranchEvidence) {
          return {
            status: ANSWERABILITY_STATUS.PARTIAL,
            reason: 'verified_branch_facility_gap',
            coveredAspects: [branchKey],
            missingAspects: ['facilities', 'lab', 'campus_infrastructure'],
            guidance: isEn
              ? 'Official records confirm the location and contact for Kampus ' + semanticFrame.targetBranch.toUpperCase() + ', but specific laboratory details are not listed.'
              : 'Dokumen resmi mencatat alamat dan kontak Kampus ' + semanticFrame.targetBranch.toUpperCase() + ', tetapi rincian sarana laboratorium belum tercantum.'
          };
        }
      }
      if (/\b(?:menerima|buka|terima)\s+(?:mahasiswa\s+baru|pendaftaran)\s+tahun\s+ini\b/i.test(rawQ) ||
          /\bkampus\s+ini\s+menerima\s+mahasiswa\s+baru\s+tahun\s+ini\b/i.test(rawQ)) {
        const { extractAcademicYearFromEvidence } = require('./groundedAnswerGenerator');
        const detectedAy = extractAcademicYearFromEvidence(accepted, null);
        if (detectedAy) {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects: ['academic_year'],
            missingAspects: ['active_wave_schedule'],
            guidance: isEn
              ? `Based on official admission publications of ITB STIKOM Bali, admission is intended for Academic Year ${detectedAy}. However, the current active registration wave status and exact schedule cutoffs are not confirmed in available records. Please check https://pmb.stikom-bali.ac.id or contact the PMB committee.`
              : `Berdasarkan dokumen resmi Penerimaan Mahasiswa Baru (PMB) ITB STIKOM Bali, materi publikasi admisi yang tercatat ditujukan untuk **Tahun Akademik ${detectedAy}**. Namun, kepastian status pendaftaran yang sedang aktif (apakah saat ini sedang dibuka gelombang tertentu beserta jadwal tanggal pendaftarannya) belum tercantum dalam dokumen indeks yang tersedia. Untuk memastikan status gelombang pendaftaran yang sedang berjalan saat ini, persyaratan berkas, serta pendaftaran online, calon mahasiswa disarankan langsung mengakses portal resmi PMB di https://pmb.stikom-bali.ac.id atau menghubungi Panitia PMB ITB STIKOM Bali.`
          };
        } else {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects: [],
            missingAspects: ['academic_year', 'active_wave_schedule'],
            guidance: isEn
              ? 'Based on available official records, confirmation of active new student admission intake is not confirmed in the available documents. Please check https://pmb.stikom-bali.ac.id or contact the PMB committee.'
              : 'Berdasarkan dokumen resmi yang tersedia, kepastian penerimaan mahasiswa baru beserta jadwal pendaftaran yang sedang aktif belum tercantum dalam dokumen indeks yang tersedia. Untuk memastikan status pendaftaran, persyaratan berkas, serta pendaftaran online, calon mahasiswa disarankan langsung mengakses portal resmi PMB di https://pmb.stikom-bali.ac.id atau menghubungi Panitia PMB ITB STIKOM Bali.'
          };
        }
      }

      const { getCalendarSummaryFromEvidence } = require('./groundedAnswerGenerator');
      const calSummary = getCalendarSummaryFromEvidence(accepted);
      const hasHistoricalCalendar = calSummary !== null && calSummary.finalRegDeadline !== null;

      if (
        semanticFrame.intent === 'CURRENT_ENROLLMENT_STATUS' ||
        /\b(?:sekarang\s+buka\s+gelombang|gelombang\s+berapa\s+(?:sekarang|saat\s*ini)|apakah\s+(?:sekarang|saat\s*ini|masih)\s+buka\s+gelombang|apakah\s+(?:pendaftaran(?:\s+[a-z0-9]+)*\s+)?(?:masih|sudah)\s+dibuka|masih\s+bisa\s+daftar\s+hari\s+ini|daftar\s+hari\s+ini|status\s+pendaftaran|pendaftaran\s+itb\s+stikom\s+apakah\s+masih\s+dibuka)\b/i.test(rawQ)
      ) {
        if (hasHistoricalCalendar) {
          const ay = calSummary.academicYear ? `Tahun Akademik ${calSummary.academicYear}` : 'arsip PMB';
          const reRegStr = calSummary.finalReRegDeadline ? ` (dengan batas akhir registrasi ulang pada ${calSummary.finalReRegDeadline})` : '';
          const partialNotice = !calSummary.isComplete15Waves
            ? ` (Catatan: arsip dokumen yang ditemukan mencakup ${calSummary.totalWavesFound} gelombang dan tidak dapat digunakan untuk menyimpulkan status seluruh gelombang PMB)`
            : '';
          if (!calSummary.isComplete15Waves) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['live_active_wave'],
              guidance: isEn
                ? `Based on the official Admissions Calendar (Kalender Pendaftaran) for ITB STIKOM Bali ${ay}, the available records only cover partial waves (${calSummary.totalWavesFound} waves, from Gelombang ${calSummary.firstWave.label} to Gelombang ${calSummary.lastWave.label}). Because the available documents do not contain the full calendar across all intake waves, whether all registration waves have closed cannot be concluded from the available evidence. Please visit the official PMB portal at https://pmb.stikom-bali.ac.id or contact admissions at (0361) 244445 to verify current enrollment status.`
                : `Berdasarkan dokumen Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} yang ditemukan, data yang tersedia hanya memuat sebagian gelombang (${calSummary.totalWavesFound} gelombang, yaitu Gelombang ${calSummary.firstWave.label} hingga Gelombang ${calSummary.lastWave.label}). Karena dokumen bukti tidak memuat seluruh gelombang pendaftaran PMB secara lengkap, status penutupan seluruh gelombang PMB tidak dapat disimpulkan dari bukti yang ada. Calon mahasiswa disarankan memantau langsung portal resmi PMB di **https://pmb.stikom-bali.ac.id** atau menghubungi Panitia PMB di (0361) 244445 untuk memastikan pembukaan gelombang pendaftaran saat ini.`
            };
          } else if (calSummary.isHistorical) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['live_active_wave'],
              guidance: isEn
                ? `Based on the official Admissions Calendar (Kalender Pendaftaran) for ITB STIKOM Bali ${ay} (historical archive records — all dates have passed and do not represent upcoming intake dates), all 15 admission intake waves concluded registration on ${calSummary.finalRegDeadline}${reRegStr}. Currently, the official schedule and opening dates for the upcoming intake / academic year have not been confirmed in the available records. To verify whether registration has reopened or to check the upcoming schedule, please visit the official PMB portal at https://pmb.stikom-bali.ac.id or contact admissions at (0361) 244445.`
                : `Berdasarkan arsip resmi Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} (catatan arsip/historis — seluruh tanggal pendaftaran telah berlalu dan bukan jadwal seleksi yang akan datang), seluruh rangkaian 15 gelombang pendaftaran yang tercatat (mulai Gelombang ${calSummary.firstWave.label} hingga Gelombang ${calSummary.lastWave.label}) telah ditutup pada **${calSummary.finalRegDeadline}**${reRegStr}.\n\nSaat ini, kepastian jadwal pembukaan pendaftaran untuk periode/intake berikutnya belum tercantum dalam dokumen resmi yang tersedia. Untuk memastikan pembaruan jadwal atau pembukaan gelombang berikutnya, calon mahasiswa disarankan memantau langsung portal resmi PMB di **https://pmb.stikom-bali.ac.id** atau menghubungi Panitia PMB di (0361) 244445.`
            };
          } else if (calSummary.isUpcoming) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['live_active_wave'],
              guidance: isEn
                ? `Based on the official Admissions Calendar for ITB STIKOM Bali ${ay} (upcoming admissions schedule), registration has not started yet and is scheduled to open starting with Gelombang ${calSummary.firstWave.label} on ${calSummary.initialRegStartDate || 'the scheduled date'}.${partialNotice} Registration is not open today.`
                : `Berdasarkan Kalender Pendaftaran resmi PMB ITB STIKOM Bali ${ay} (jadwal pendaftaran mendatang), pendaftaran mahasiswa baru saat ini belum dimulai dan dijadwalkan akan dibuka mulai Gelombang ${calSummary.firstWave.label} pada **${calSummary.initialRegStartDate || 'tanggal yang ditetapkan'}**.${partialNotice}\n\nPendaftaran belum dibuka hari ini. Silakan memantau portal resmi di **https://pmb.stikom-bali.ac.id**.`
            };
          }
        }
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'admission_schedule_unconfirmed',
          coveredAspects: [],
          missingAspects: ['live_active_wave', 'admission_calendar'],
          guidance: isEn
            ? 'Official information regarding current registration wave status is not confirmed in the available guidelines. Please visit the official PMB portal at https://pmb.stikom-bali.ac.id or contact admissions at (0361) 244445.'
            : 'Informasi resmi mengenai status gelombang pendaftaran yang sedang berjalan saat ini belum dapat dipastikan dari dokumen yang tersedia. Silakan langsung memeriksa portal resmi PMB di **https://pmb.stikom-bali.ac.id** atau menghubungi Panitia PMB di (0361) 244445.'
        };
      }

      if (/\b(?:minggu\s+depan|masih\s+sempat|masih\s+bisa\s+daftar\s+minggu\s+depan|apakah\s+masih\s+sempat)\b/i.test(rawQ)) {
        if (hasHistoricalCalendar) {
          const ay = calSummary.academicYear ? `Tahun Akademik ${calSummary.academicYear}` : 'arsip PMB';
          if (!calSummary.isComplete15Waves) {
            return {
              status: ANSWERABILITY_STATUS.UNKNOWN,
              reason: 'admission_schedule_unconfirmed',
              coveredAspects: ['admission_calendar'],
              missingAspects: ['registration_deadline'],
              guidance: isEn
                ? `Based on the admissions calendar documents found for ITB STIKOM Bali ${ay}, the available records only cover partial waves (${calSummary.totalWavesFound} waves). Because the records do not cover all intake waves, the final registration deadline across all waves cannot be confirmed. Please check https://pmb.stikom-bali.ac.id.`
                : `Berdasarkan dokumen Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} yang ditemukan, data yang tersedia hanya memuat sebagian gelombang (${calSummary.totalWavesFound} gelombang). Karena dokumen tidak memuat seluruh gelombang pendaftaran secara lengkap, batas akhir pendaftaran untuk seluruh gelombang belum dapat dipastikan dari bukti yang ada. Silakan langsung memeriksa portal https://pmb.stikom-bali.ac.id.`
            };
          }
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects: ['admission_calendar'],
            missingAspects: ['registration_deadline'],
            guidance: isEn
              ? `Based on the official Admissions Calendar (Kalender Pendaftaran) for ITB STIKOM Bali ${ay} (historical archive records), all recorded intake waves concluded registration on ${calSummary.finalRegDeadline} and opening dates for the upcoming intake are not confirmed in the records, so whether registration is still open next week cannot be confirmed. Please check https://pmb.stikom-bali.ac.id.`
              : `Berdasarkan arsip resmi Kalender Pendaftaran PMB ITB STIKOM Bali ${ay} (catatan arsip/historis), seluruh gelombang pendaftaran yang tercatat telah berakhir pada **${calSummary.finalRegDeadline}** dan jadwal gelombang pendaftaran berikutnya belum tercantum dalam dokumen, sehingga kepastian apakah pendaftaran masih dibuka pada minggu depan belum dapat dipastikan. Silakan langsung memeriksa portal https://pmb.stikom-bali.ac.id.`
          };
        }
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'admission_schedule_unconfirmed',
          coveredAspects: [],
          missingAspects: ['registration_deadline'],
          guidance: isEn
            ? 'Based on available official documents, the exact deadline date for the current registration intake wave is not specified. To confirm whether registration is still open at that time, please consult the official admission portal at https://pmb.stikom-bali.ac.id.'
            : 'Berdasarkan dokumen resmi yang tersedia, kepastian batas akhir tanggal pendaftaran gelombang saat ini belum tercantum. Untuk memastikan apakah pendaftaran masih dibuka pada waktu tersebut, silakan langsung memeriksa portal https://pmb.stikom-bali.ac.id.'
        };
      }

      if (semanticFrame.domain === 'TUITION_FEE' || requiredAspects.some(a => ['fee', 'tuition', 'dpp'].includes(a))) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'insufficient_fee_aspect_coverage',
          coveredAspects: [],
          missingAspects: requiredAspects,
          guidance: isEn
            ? 'Official information regarding tuition fee details for that study program is not fully listed in the available guide.'
            : 'Informasi resmi mengenai rincian biaya kuliah untuk program studi tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.UNKNOWN,
        reason: 'insufficient_aspect_evidence',
        coveredAspects: [],
        missingAspects: requiredAspects,
        guidance: isEn
          ? 'Official information regarding that aspect is not fully listed in the available guidelines.'
          : 'Informasi resmi terkait aspek tersebut belum tercantum secara lengkap dalam panduan yang tersedia.'
      };
    }

    if (missingAspects.length > 0 && coveredAspects.length > 0) {
      if (/\b(?:menerima|buka|terima)\s+(?:mahasiswa\s+baru|pendaftaran)\s+tahun\s+ini\b/i.test(rawQ) ||
          /\bkampus\s+ini\s+menerima\s+mahasiswa\s+baru\s+tahun\s+ini\b/i.test(rawQ)) {
        const { extractAcademicYearFromEvidence } = require('./groundedAnswerGenerator');
        const detectedAy = extractAcademicYearFromEvidence(accepted, null);
        if (detectedAy) {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects,
            missingAspects,
            guidance: isEn
              ? `Based on official admission publications of ITB STIKOM Bali, admission is intended for Academic Year ${detectedAy}. However, the current active registration wave status and exact schedule cutoffs are not confirmed in available records. Please check https://pmb.stikom-bali.ac.id or contact the PMB committee.`
              : `Berdasarkan dokumen resmi Penerimaan Mahasiswa Baru (PMB) ITB STIKOM Bali, materi publikasi admisi yang tercatat ditujukan untuk **Tahun Akademik ${detectedAy}**. Namun, kepastian status pendaftaran yang sedang aktif (apakah saat ini sedang dibuka gelombang tertentu beserta jadwal tanggal pendaftarannya) belum tercantum dalam dokumen indeks yang tersedia. Untuk memastikan status gelombang pendaftaran yang sedang berjalan saat ini, persyaratan berkas, serta pendaftaran online, calon mahasiswa disarankan langsung mengakses portal resmi PMB di https://pmb.stikom-bali.ac.id atau menghubungi Panitia PMB ITB STIKOM Bali.`
          };
        } else {
          return {
            status: ANSWERABILITY_STATUS.UNKNOWN,
            reason: 'admission_schedule_unconfirmed',
            coveredAspects: [],
            missingAspects: ['academic_year', 'active_wave_schedule'],
            guidance: isEn
              ? 'Based on available official records, confirmation of active new student admission intake is not confirmed in the available documents. Please check https://pmb.stikom-bali.ac.id or contact the PMB committee.'
              : 'Berdasarkan dokumen resmi yang tersedia, kepastian penerimaan mahasiswa baru beserta jadwal pendaftaran yang sedang aktif belum tercantum dalam dokumen indeks yang tersedia. Untuk memastikan status pendaftaran, persyaratan berkas, serta pendaftaran online, calon mahasiswa disarankan langsung mengakses portal resmi PMB di https://pmb.stikom-bali.ac.id atau menghubungi Panitia PMB ITB STIKOM Bali.'
          };
        }
      }

      if (/\b(?:minggu\s+depan|masih\s+sempat|masih\s+bisa\s+daftar\s+minggu\s+depan|apakah\s+masih\s+sempat|sampai\s+kapan\s+pendaftaran|batas\s+akhir\s+pendaftaran|kapan\s+terakhir)\b/i.test(rawQ)) {
        return {
          status: ANSWERABILITY_STATUS.UNKNOWN,
          reason: 'admission_schedule_unconfirmed',
          coveredAspects,
          missingAspects,
          guidance: isEn
            ? 'Based on available official documents, the exact deadline date for the current registration intake wave is not specified. To confirm whether registration is still open at that time, please consult the official admission portal at https://pmb.stikom-bali.ac.id.'
            : 'Berdasarkan dokumen resmi yang tersedia, kepastian batas akhir tanggal pendaftaran gelombang saat ini belum tercantum. Untuk memastikan apakah pendaftaran masih dibuka pada waktu tersebut, silakan langsung memeriksa portal https://pmb.stikom-bali.ac.id.'
        };
      }
      return {
        status: ANSWERABILITY_STATUS.PARTIAL,
        reason: 'partial_aspect_coverage',
        coveredAspects,
        missingAspects,
        guidance: isEn
          ? `Information regarding ${missingAspects.join(', ')} is not fully listed in the available guidelines.`
          : `Informasi terkait ${missingAspects.join(', ')} belum tercantum secara lengkap dalam panduan yang tersedia.`
      };
    }
  }

  // 4. If subqueries exist and some lack evidence
  if (semanticFrame.subQueries && semanticFrame.subQueries.length > 1) {
    return {
      status: ANSWERABILITY_STATUS.PARTIAL,
      reason: 'multi_subquery_partial_coverage',
      coveredAspects: requiredAspects,
      missingAspects: []
    };
  }

  // 5. Fully supported
  return {
    status: ANSWERABILITY_STATUS.ANSWERABLE,
    reason: 'sufficient_supported_evidence',
    coveredAspects: requiredAspects,
    missingAspects: []
  };
}

module.exports = {
  ANSWERABILITY_STATUS,
  evaluateAnswerability
};
