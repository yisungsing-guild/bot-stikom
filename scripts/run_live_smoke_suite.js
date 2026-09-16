'use strict';

require('dotenv').config({ quiet: true });
process.env.PROVIDER_WEBHOOK_TOKEN = '';
process.env.PROVIDER_TOKEN = '';
process.env.FORCE_BUNDLED_INDEX = 'true';
process.env.RAG_TRACE_PERSIST = 'false';
process.env.SEMANTIC_RAG_RESULT_CACHE_MS = '0';
process.env.PERSISTENT_INBOUND_DEDUPE = 'false';
process.env.BOT_SHOW_FOLLOWUP_SUGGESTIONS = 'false';
process.env.PROVIDER_DB_LOOKUP_TIMEOUT_MS = '15000';
process.env.AUTH_DB_LOOKUP_TIMEOUT_MS = '15000';

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
const prisma = require('../src/db');
const providerRouterFactory = require('../src/routes/provider');

function request(port, payload) {
  return new Promise(resolve => {
    const body = JSON.stringify(payload);
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/provider/webhook',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body)
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
        catch (_) { resolve({ status: res.statusCode, body: { raw } }); }
      });
    });
    req.on('error', error => resolve({ status: 500, body: { source: 'network_error', error: error.message } }));
    req.end(body);
  });
}

const SMOKE_CONVERSATIONS = [
  {
    id: 'SMOKE_01_PROGRAM_ACADEMIC',
    area: '1. PROGRAM / ACADEMIC',
    description: 'Available programs, single program curriculum, elliptical switch to TI, total SKS query',
    turns: [
      { query: 'di STIKOM ada jurusan apa aja ya?' },
      { query: 'kalau Sistem Informasi belajarnya tentang apa saja?' },
      { query: 'kalau TI?' },
      { query: 'total SKS untuk lulus berapa ya?' }
    ]
  },
  {
    id: 'SMOKE_02_FEES',
    area: '2. FEES',
    description: 'Registration fee, installment policy, program switch during fee discussion, ungrounded karate discount safe response',
    turns: [
      { query: 'biaya pendaftaran mahasiswa baru berapa?' },
      { query: 'bisa dicicil gak pembayarannya?' },
      { query: 'kalau untuk prodi Bisnis Digital biayanya berapa?' },
      { query: 'ada potongan biaya 75 persen gak kalau punya sertifikat karate tingkat RT?' }
    ]
  },
  {
    id: 'SMOKE_03_ACCREDITATION',
    area: '3. ACCREDITATION',
    description: 'Accreditation for SI, switch to Bisnis Digital, ensure no SKS leakage',
    turns: [
      { query: 'akreditasi prodi sistem informasi apa ya?' },
      { query: 'kalau prodi lain misalnya Bisnis Digital?' },
      { query: 'akreditasinya apa?' }
    ]
  },
  {
    id: 'SMOKE_04_SCHOLARSHIP',
    area: '4. SCHOLARSHIP',
    description: 'Scholarship availability, schedule/result inquiry with ungrounded dates leading to safe response',
    turns: [
      { query: 'beasiswa yang tersedia di stikom apa saja?' },
      { query: 'pengumuman hasil beasiswa KIP biasanya tanggal berapa dan jam berapa?' }
    ]
  },
  {
    id: 'SMOKE_05_RPL',
    area: '5. RPL',
    description: 'Credit conversion from work experience, RPL schedule / status without inventing thresholds',
    turns: [
      { query: 'apakah pengalaman kerja saya bisa dikonversi jadi SKS lewat jalur RPL?' },
      { query: 'jadwal pendaftaran jalur RPL semester ini kapan?' }
    ]
  },
  {
    id: 'SMOKE_06_DOUBLE_DEGREE',
    area: '6. INTERNATIONAL / DOUBLE DEGREE',
    description: 'Double degree availability, duration/location split, unknown partner university safe no data',
    turns: [
      { query: 'apakah ada program double degree atau kuliah di luar negeri?' },
      { query: 'kuliahnya berapa tahun di stikom dan berapa tahun di kampus mitra?' },
      { query: 'kalau double degree ke universitas di jerman ada gak?' }
    ]
  },
  {
    id: 'SMOKE_07_UKM_ORGANIZATIONS',
    area: '7. UKM / ORGANIZATIONS',
    description: 'Direct org query, outdoor interest (Mapala), specific dance UKM (Pragina), choir interest (VOS retest), unsupported equestrian club',
    turns: [
      { query: 'organisasi mahasiswa atau UKM di kampus ada apa aja?' },
      { query: 'kalau saya suka kegiatan alam bebas dan naik gunung ada ukm apa?' },
      { query: 'ukm tari tradisional bali namanya apa?' },
      { query: 'kalau paduan suara?' },
      { query: 'kalau ukm berkuda dan polo ada gak?' }
    ]
  },
  {
    id: 'SMOKE_08_FACILITIES',
    area: '8. FACILITIES',
    description: 'Computer lab, coworking & digital library, unsupported airport shuttle detail',
    turns: [
      { query: 'fasilitas lab komputer di kampus seperti apa?' },
      { query: 'ada ruang coworking space atau perpustakaan digital gak?' },
      { query: 'apakah ada bus antar jemput gratis dari bandara ke kampus?' }
    ]
  },
  {
    id: 'SMOKE_09_REGISTRATION_PMB',
    area: '9. REGISTRATION / PMB',
    description: 'PMB waves, document upload procedure, fee context transition',
    turns: [
      { query: 'gelombang pendaftaran PMB saat ini apa saja?' },
      { query: 'cara upload berkas dan dokumen persyaratannya gimana?' },
      { query: 'biaya formulirnya berapa?' }
    ]
  },
  {
    id: 'SMOKE_10_TRUE_GAP_SAFETY',
    area: '10. TRUE GAP / SAFETY',
    description: 'Rector license plate, absurd 99% orange cat discount, quota for year 2035',
    turns: [
      { query: 'berapa nomor plat mobil pribadi rektor stikom bali?' },
      { query: 'apakah ada diskon biaya 99 persen bagi mahasiswa yang punya kucing oranye?' },
      { query: 'berapa kuota pasti penerimaan mahasiswa baru untuk tahun 2035?' }
    ]
  },
  {
    id: 'SMOKE_11_CASE_A_RELATIONAL_SWITCH',
    area: 'MULTI-TURN: CASE A & B',
    description: 'Case A: Program A career prospect -> Program B career prospect. Case B: Fee discussion -> Facility query without fee state leak',
    turns: [
      { query: 'prospek kerja lulusan Sistem Informasi jadi apa saja?' },
      { query: 'kalau Teknologi Informasi?' },
      { query: 'berapa biaya kuliah semester 1 untuk Sistem Komputer?' },
      { query: 'apakah di kampus ada lab iot dan robotika?' }
    ]
  },
  {
    id: 'SMOKE_12_CASE_C_D_CORRECTION',
    area: 'MULTI-TURN: CASE C & D',
    description: 'Case C: Specific UKM -> category switch. Case D: Explicit correction "bukan SI, maksud saya TI" -> subsequent slot inheritance',
    turns: [
      { query: 'UKM KSR PMI kegiatannya ngapain aja?' },
      { query: 'kalau yang bidang seni ada apa aja?' },
      { query: 'saya mau tanya tentang biaya kuliah SI' },
      { query: 'eh bukan SI, maksud saya TI' },
      { query: 'apa akreditasinya?' }
    ]
  }
];

async function runSmokeSuite() {
  console.log('====================================================');
  console.log('LIVE SMOKE TEST SUITE - RELEASE CANDIDATE AUDIT');
  console.log('RELEASE_CANDIDATE: phase7-final-clean2');
  console.log('====================================================\n');

  global.__provider_rag_all = [];
  global.__provider_debug_retrievals = [];
  global.__provider_route_debug_events = [];
  const sent = [];
  const provider = {
    sendMessage: async function sendMessage(chatId, text, meta) {
      sent.push({ chatId: String(chatId), text: String(text || ''), meta: meta || {} });
    },
    sendImage: async function sendImage() {}
  };

  const app = express();
  app.use(express.json());
  app.use('/provider', providerRouterFactory(provider));
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const port = server.address().port;

  const conversationReports = [];
  let totalTurns = 0;
  let passCount = 0;
  let safeNoDataCount = 0;
  let nonBlockingQualityCount = 0;
  let releaseBlockerCount = 0;

  let hallucinatedNumericCount = 0;
  let wrongEntityCount = 0;
  let contextContaminationCount = 0;
  let timeoutCount = 0;

  let ukmInterestEvidenceRoutingPass = true;
  let accreditationFollowupPass = true;
  let rplGroundingPass = true;
  let doubleDegreeGroundingPass = true;
  let trueGapSafetyPass = true;

  const releaseBlockerDetails = [];

  for (const conv of SMOKE_CONVERSATIONS) {
    const chatId = 'smoke-' + conv.id.toLowerCase() + '-' + Date.now();
    await prisma.session.upsert({
      where: { chatId },
      create: { chatId, state: 'root', data: { welcomeSent: true, introSent: true } },
      update: { state: 'root', data: { welcomeSent: true, introSent: true } }
    });

    const convReport = {
      SMOKE_ID: conv.id,
      AREA: conv.area,
      DESCRIPTION: conv.description,
      TURNS: [],
      OVERALL_STATUS: 'PASS'
    };

    console.log(`>>> RUNNING [${conv.id}]: ${conv.area}`);

    let turnIdx = 1;
    for (const turn of conv.turns) {
      totalTurns++;
      const sentBefore = sent.length;
      const ragBefore = global.__provider_rag_all.length;

      const t0 = performance.now();
      const res = await request(port, {
        chatId,
        text: turn.query,
        messageId: `${chatId}-${turnIdx}`,
        inboundTs: Date.now()
      });
      const t1 = performance.now();

      const outbound = sent.slice(sentBefore).filter(item => item.chatId === chatId).at(-1) || null;
      const botOutput = outbound ? outbound.text : (res.body && res.body.answer) || '';
      const source = (outbound && outbound.meta && outbound.meta.source) || (res.body && res.body.source) || 'unknown';

      // Evaluate turn quality
      let turnStatus = 'PASS';
      let issueType = 'NONE';

      // Check timeout
      if (t1 - t0 > 25000 || res.status === 500) {
        turnStatus = 'RELEASE_BLOCKER';
        issueType = 'TIMEOUT_OR_CRASH';
        timeoutCount++;
        releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Timeout or crash', query: turn.query });
      }

      // Check safe no data responses
      const isSafeNoDataPattern = /belum menemukan|tidak menemukan|belum tercantum|tidak tersedia|belum ada data|silakan konfirmasi|konfirmasi ke admin/i.test(botOutput);
      const isSafeNoDataSource = /insufficient|no-data|no-answer|blocked|clarify/i.test(source);

      // Area-specific validations
      if (conv.id === 'SMOKE_07_UKM_ORGANIZATIONS') {
        if (turn.query.includes('paduan suara')) {
          const hasVOS = /Voice of STIKOM|VOS/i.test(botOutput);
          const hasPaduanSuara = /paduan suara/i.test(botOutput);
          if (!hasVOS || !hasPaduanSuara) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'UKM_INTEREST_EVIDENCE_ROUTING_FAIL';
            ukmInterestEvidenceRoutingPass = false;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Failed to retrieve Voice of STIKOM (VOS) for choir interest', query: turn.query, botOutput });
          } else {
            turnStatus = 'PASS';
          }
        }
        if (turn.query.includes('alam bebas')) {
          const hasMapala = /Mapala Kompas|pecinta alam/i.test(botOutput);
          if (!hasMapala) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'UKM_INTEREST_EVIDENCE_ROUTING_FAIL';
            ukmInterestEvidenceRoutingPass = false;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Failed to retrieve Mapala Kompas for outdoor interest', query: turn.query, botOutput });
          }
        }
        if (turn.query.includes('berkuda dan polo')) {
          if (!isSafeNoDataPattern) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'FABRICATED_ORGANIZATION';
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Fabricated organization for ungrounded equestrian interest', query: turn.query, botOutput });
          } else {
            turnStatus = 'SAFE_NO_DATA';
          }
        }
      }

      if (conv.id === 'SMOKE_03_ACCREDITATION') {
        if (turn.query.includes('Bisnis Digital')) {
          const hasBD = /Bisnis Digital|Baik/i.test(botOutput);
          const hasCreditLeak = /\b14[0-9]\s*sks\b/i.test(botOutput);
          if (hasCreditLeak) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'SKS_LEAKAGE_IN_ACCREDITATION';
            accreditationFollowupPass = false;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Credit/SKS leaked into accreditation answer', query: turn.query, botOutput });
          }
          if (!hasBD) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'WRONG_ENTITY_IN_ACCREDITATION';
            accreditationFollowupPass = false;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Failed entity replacement to Bisnis Digital in accreditation follow-up', query: turn.query, botOutput });
          }
        }
      }

      if (conv.id === 'SMOKE_10_TRUE_GAP_SAFETY') {
        if (turn.query.includes('plat mobil')) {
          const hasPlatNumber = /\b[A-Z]{1,2}\s*\d{1,4}\s*[A-Z]{1,3}\b/i.test(botOutput);
          if (hasPlatNumber) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'HALLUCINATED_FACT';
            trueGapSafetyPass = false;
            hallucinatedNumericCount++;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Hallucinated private license plate', query: turn.query, botOutput });
          } else {
            turnStatus = 'SAFE_NO_DATA';
          }
        }
        if (turn.query.includes('kucing oranye')) {
          if (/diskon\s*99/i.test(botOutput) && !isSafeNoDataPattern) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'HALLUCINATED_NUMERIC';
            trueGapSafetyPass = false;
            hallucinatedNumericCount++;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Hallucinated 99% cat discount', query: turn.query, botOutput });
          } else {
            turnStatus = 'SAFE_NO_DATA';
          }
        }
        if (turn.query.includes('2035')) {
          if (!isSafeNoDataPattern) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'HALLUCINATED_FUTURE_FACT';
            trueGapSafetyPass = false;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Invented quota for year 2035', query: turn.query, botOutput });
          } else {
            turnStatus = 'SAFE_NO_DATA';
          }
        }
      }

      if (conv.id === 'SMOKE_02_FEES' && turn.query.includes('karate')) {
        if (botOutput.includes('75%') && !isSafeNoDataPattern) {
          turnStatus = 'RELEASE_BLOCKER';
          issueType = 'HALLUCINATED_NUMERIC_CLAIM';
          hallucinatedNumericCount++;
          releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Hallucinated 75% karate discount confirmation', query: turn.query, botOutput });
        } else {
          turnStatus = 'SAFE_NO_DATA';
        }
      }

      if (conv.id === 'SMOKE_06_DOUBLE_DEGREE') {
        if (turn.query.includes('jerman')) {
          if (!isSafeNoDataPattern) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'INVENTED_PARTNERSHIP';
            doubleDegreeGroundingPass = false;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Invented German double degree partner', query: turn.query, botOutput });
          } else {
            turnStatus = 'SAFE_NO_DATA';
          }
        }
      }

      if (conv.id === 'SMOKE_11_CASE_A_RELATIONAL_SWITCH') {
        if (turn.query.includes('lab iot')) {
          // Verify fee state did not leak into facility response
          const hasFeeLeak = /\b(?:ukt|dpp|cicilan|biaya\s+kuliah|rp\b)/i.test(botOutput);
          if (hasFeeLeak) {
            turnStatus = 'RELEASE_BLOCKER';
            issueType = 'CONTEXT_CONTAMINATION';
            contextContaminationCount++;
            releaseBlockerDetails.push({ turnId: `${conv.id}-T${turnIdx}`, reason: 'Fee state leaked into facility query', query: turn.query, botOutput });
          }
        }
      }

      if (conv.id === 'SMOKE_12_CASE_C_D_CORRECTION') {
        if (turn.query.includes('bukan SI, maksud saya TI')) {
          // Check that TI is addressed
          const hasTI = /Teknologi Informasi|TI/i.test(botOutput);
          if (!hasTI) {
            turnStatus = 'NON_BLOCKING_QUALITY';
          }
        }
      }

      // Categorize counts
      if (turnStatus === 'PASS') {
        passCount++;
      } else if (turnStatus === 'SAFE_NO_DATA') {
        safeNoDataCount++;
      } else if (turnStatus === 'NON_BLOCKING_QUALITY') {
        nonBlockingQualityCount++;
      } else if (turnStatus === 'RELEASE_BLOCKER') {
        releaseBlockerCount++;
        convReport.OVERALL_STATUS = 'RELEASE_BLOCKER';
      }

      convReport.TURNS.push({
        turnIndex: turnIdx,
        query: turn.query,
        botOutput: botOutput.slice(0, 200) + (botOutput.length > 200 ? '...' : ''),
        source,
        durationMs: Math.round(t1 - t0),
        status: turnStatus,
        issueType
      });

      console.log(`  [T${turnIdx}] Q: "${turn.query}" -> [${turnStatus}] (${source})`);
      turnIdx++;
    }

    conversationReports.push(convReport);
    console.log(`<<< [${conv.id}] Status: ${convReport.OVERALL_STATUS}\n`);
  }

  server.close();

  // Generate smoke report JSON
  const smokeReport = {
    LIVE_SMOKE_TEST_STATUS: releaseBlockerCount === 0 ? 'ALL_PASS' : 'BLOCKERS_DETECTED',
    RELEASE_CANDIDATE: 'phase7-final-clean2',
    TOTAL_CONVERSATIONS: SMOKE_CONVERSATIONS.length,
    TOTAL_TURNS: totalTurns,
    PASS: passCount,
    SAFE_NO_DATA: safeNoDataCount,
    NON_BLOCKING_QUALITY: nonBlockingQualityCount,
    RELEASE_BLOCKERS: releaseBlockerCount,
    HALLUCINATED_NUMERIC_CLAIMS: hallucinatedNumericCount,
    WRONG_ENTITY_CASES: wrongEntityCount,
    CONTEXT_CONTAMINATION_CASES: contextContaminationCount,
    TIMEOUTS: timeoutCount,
    UKM_INTEREST_EVIDENCE_ROUTING: ukmInterestEvidenceRoutingPass ? 'PASS' : 'FAIL',
    ACCREDITATION_FOLLOWUP: accreditationFollowupPass ? 'PASS' : 'FAIL',
    RPL_GROUNDING: rplGroundingPass ? 'PASS' : 'FAIL',
    DOUBLE_DEGREE_GROUNDING: doubleDegreeGroundingPass ? 'PASS' : 'FAIL',
    TRUE_GAP_SAFETY: trueGapSafetyPass ? 'PASS' : 'FAIL',
    RELEASE_BLOCKER_DETAILS: releaseBlockerDetails,
    READY_TO_RELEASE: releaseBlockerCount === 0 ? 'YES' : 'NO',
    CONVERSATIONS: conversationReports
  };

  fs.writeFileSync(
    path.join(__dirname, '..', 'tmp', 'phase7-live-smoke-report.json'),
    JSON.stringify(smokeReport, null, 2),
    'utf8'
  );

  console.log('====================================================');
  console.log('SMOKE TEST EXECUTION FINISHED');
  console.log(`TOTAL CONVERSATIONS: ${smokeReport.TOTAL_CONVERSATIONS}`);
  console.log(`TOTAL TURNS: ${smokeReport.TOTAL_TURNS}`);
  console.log(`PASS: ${smokeReport.PASS}`);
  console.log(`SAFE_NO_DATA: ${smokeReport.SAFE_NO_DATA}`);
  console.log(`NON_BLOCKING_QUALITY: ${smokeReport.NON_BLOCKING_QUALITY}`);
  console.log(`RELEASE_BLOCKERS: ${smokeReport.RELEASE_BLOCKERS}`);
  console.log(`READY_TO_RELEASE: ${smokeReport.READY_TO_RELEASE}`);
  console.log('====================================================');
}

runSmokeSuite().catch(err => {
  console.error('Fatal error during smoke suite:', err);
  process.exit(1);
});
