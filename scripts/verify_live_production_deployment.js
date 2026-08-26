const https = require('https');

const SMOKE_TOKEN = 'live_smoke_gate_3e9a57a7b8323014a290428a0bc7b0613df6dab0_71012c0';
const BASE_URL = 'https://bot-stikom-production-ff1e.up.railway.app';

function postSmoke(queries) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ queries });
    const req = https.request(`${BASE_URL}/internal/semantic-smoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SMOKE_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 45000
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, rawBody: body, error: e.message });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timeout'));
    });
    req.write(payload);
    req.end();
  });
}

async function runLiveSmoke() {
  console.log('=== RUNNING LIVE PRODUCTION DEPLOYMENT VALIDATION ===');
  console.log(`Target: ${BASE_URL}/internal/semantic-smoke`);

  const queries = [
    { id: 'schedule', query: 'kapan pendaftaran pmb ditutup?' },
    { id: 'program_comparison', query: 'Perbedaan program S1 dan D3 apa?' },
    { id: 'program_list', query: 'program studi apa saja yang ada di ITB STIKOM Bali?' },
    { id: 'ormawa_count', query: 'berapa jumlah ormawa di ITB STIKOM Bali?' },
    { id: 'ormawa_list', query: 'daftar ukm apa saja yang ada di stikom?' },
    { id: 'career_center', query: 'apa fungsi Career Center?' },
    { id: 'employment_support', query: 'apakah ITB STIKOM Bali membantu lulusannya mendapatkan pekerjaan?' },
    { id: 'career_rec', query: 'Kalau S1 yang cocok untuk bekerja di bidang pemasaran yang mana ya?' },
    { id: 'fee_reg', query: 'berapa biaya pendaftaran pmb?' },
    { id: 'fee_spp', query: 'biaya ukt per semester berapa?' },
    { id: 'accreditation_ti', query: 'akreditasi TI apa?' },
    { id: 'accreditation_validity', query: 'masa berlaku akreditasi TI sampai kapan?' }
  ];

  const res = await postSmoke(queries);
  console.log(`Response Status: ${res.status}`);
  if (res.status !== 200 || !res.data || !res.data.ok) {
    console.error('Smoke endpoint call failed:', JSON.stringify(res, null, 2));
    process.exit(1);
  }

  console.log('Index Health:', JSON.stringify(res.data.indexHealth, null, 2));

  const results = res.data.results || [];
  let passed = 0;
  let failed = 0;

  for (const item of results) {
    const { id, query, durationMs, source, answer, confidenceScore } = item;
    console.log(`\n[CHECK: ${id}] (${durationMs}ms) Score: ${confidenceScore} | Source: ${source}`);
    console.log(`Query : "${query}"`);
    console.log(`Answer: ${answer ? answer.slice(0, 160).replace(/\n/g, ' ') + '...' : '(EMPTY)'}`);

    let ok = true;
    let failReason = '';

    if (id === 'schedule') {
      if (!/gelombang|pendaftaran|pmb/i.test(answer) || /belum menemukan data/i.test(answer)) {
        ok = false; failReason = 'Missing schedule details';
      }
    } else if (id === 'program_comparison') {
      if (!/S1|Sarjana/i.test(answer) || !/D3|Diploma/i.test(answer)) {
        ok = false; failReason = 'Missing S1 vs D3 comparison content';
      }
    } else if (id === 'program_list') {
      if (!/Sistem Informasi|Teknologi Informasi|Bisnis Digital/i.test(answer)) {
        ok = false; failReason = 'Missing program list';
      }
    } else if (id === 'ormawa_count') {
      if (!/\b(32|tiga puluh dua)\b/i.test(answer) || !/UKM|ORMAWA|organisasi/i.test(answer)) {
        ok = false; failReason = 'Missing exact 32 ORMAWA count';
      }
    } else if (id === 'ormawa_list') {
      if (!/MCOS|KSL|BEM|DPM|Himaprodi/i.test(answer)) {
        ok = false; failReason = 'Missing ORMAWA enumeration';
      }
    } else if (id === 'career_center') {
      if (!/Career Center|karier|karir|lowongan|magang|pelatihan|job fair/i.test(answer)) {
        ok = false; failReason = 'Missing Career Center functions';
      }
    } else if (id === 'employment_support') {
      if (!/membantu|lowongan|magang|job fair|campus hiring|persiapan kerja|pembekalan/i.test(answer)) {
        ok = false; failReason = 'Missing employment support grounding';
      }
    } else if (id === 'career_rec') {
      if (!/Bisnis Digital|digital marketing|marketing|pemasaran/i.test(answer)) {
        ok = false; failReason = 'Missing BD career recommendation';
      }
      if (/Teknik Informatika.*pemasaran/i.test(answer)) {
        ok = false; failReason = 'Hallucinated non-existent program';
      }
    } else if (id === 'fee_reg') {
      if (!/500\.000|500000|biaya pendaftaran/i.test(answer)) {
        ok = false; failReason = 'Missing registration fee';
      }
    } else if (id === 'fee_spp') {
      if (!/UKT|semester|6\.500\.000|4\.500\.000/i.test(answer)) {
        ok = false; failReason = 'Missing SPP fee details';
      }
    } else if (id === 'accreditation_ti') {
      if (!/Teknologi Informasi/i.test(answer) || !/\bBaik\b/i.test(answer)) {
        ok = false; failReason = 'Missing TI accreditation';
      }
    } else if (id === 'accreditation_validity') {
      if (!/2027|berlaku|akreditasi/i.test(answer)) {
        ok = false; failReason = 'Missing TI accreditation validity period';
      }
    }

    if (ok) {
      console.log(`Result: PASS`);
      passed += 1;
    } else {
      console.error(`Result: FAIL - ${failReason}`);
      failed += 1;
    }
  }

  console.log(`\n====================================================`);
  console.log(`TOTAL PRODUCTION CHECKS: ${results.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log(`====================================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runLiveSmoke().catch(err => {
  console.error('Unhandled error in live smoke:', err);
  process.exit(1);
});
