const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'src', 'routes', 'provider.js');
let s = fs.readFileSync(file, 'utf8');
const re = /const overview = buildAdmissionCalendarOverviewMessage\(cal\);[\s\S]*?source: 'pmb_schedule_fast_overview_pre_keyword',[\s\S]*?\n\s*}\n\s*}\n/;
if (!re.test(s)) {
  console.error('Pattern not found, aborting');
  process.exit(2);
}
const newBlock = `const overview = buildAdmissionCalendarOverviewMessage(cal);
        if (overview) {
          // If the inbound text explicitly looks like a fee/cost question,
          // skip adding the schedule overview candidate so downstream
          // fee fast-path / RAG post-process can produce a fee-structured reply.
          const looksLikeFeeForSched = /\\b(biaya|rincian|pendaftaran|dpp|ukt|per\\s*semester|potongan|diskon|total\\s+biaya)\\b/i.test(String(text || '')) ||
            (typeof parseFeeDetailChoice === 'function' && parseFeeDetailChoice(String(text || '')));

          if (!looksLikeFeeForSched) {
            addRuleCandidate({
              source: 'pmb_schedule_fast_overview_pre_keyword',
              answer: overview,
              confidence: 0.75,
              commit: async () => {
                const currentState = session ? session.state : 'root';
                const prevData = sessionData || {};
                const newData = { ...prevData, pendingScheduleWave: { ts: new Date().toISOString() } };
                await prisma.session.upsert({
                  where: { chatId },
                  create: { chatId, state: currentState, data: newData },
                  update: { chatId, state: currentState, data: newData }
                });
              }
            });
          } else {
            try { console.log('[ProviderRoute] Skipping schedule overview because question looks like fee query', { chatId, textPreview: String(text || '').slice(0,120) }); } catch (e) {}
          }
        }
`;

s = s.replace(re, newBlock);
fs.writeFileSync(file, s, 'utf8');
console.log('Patched provider.js via regex');
