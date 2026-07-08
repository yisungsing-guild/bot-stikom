const fs = require('fs');
const data = JSON.parse(fs.readFileSync('tmp_audit_summary.json','utf8'));

const queries = [
  'berapa biaya TI gelombang 1A',
  'berapa biaya TI gelombang 2C',
  'berapa biaya SI gelombang 2C',
  'berapa biaya SK gelombang 1A'
];

function parseAmt(s){ if(!s) return 0; const cleaned = String(s).replace(/[^0-9]/g,''); return cleaned?parseInt(cleaned,10):0; }
function fmt(n){ return 'Rp '+String(n).replace(/\B(?=(\d{3})+(?!\d))/g,'.'); }

for(const q of queries){
  const entry = data.find(x=>x.query===q);
  console.log('---', q);
  if(!entry || !entry.feeStruct){ console.log('MISSING feeStruct\n'); continue; }
  const fee = entry.feeStruct;
  const items = Array.isArray(fee.initialCostItems)?fee.initialCostItems:[];
  // onboarding tokens
  const tokens = ['jas','almamater','topi','kaos','tas','seragam','gmt','gmti'];
  const onboarding = items.filter(it => {
    const label = String(it.label||'').toLowerCase();
    const timing = String(it.timing||'').toLowerCase();
    return tokens.some(t=>label.includes(t)) || /registrasi/.test(timing);
  });
  // build output
  console.log(`Biaya awal masuk untuk Prodi ${fee.programName||fee.program||'Program Studi'}:\n`);
  if(onboarding.length===0) console.log('(tidak ada item onboarding terdeteksi)\n');
  let subtotal=0;
  for(const it of onboarding){
    const amt = parseAmt(it.amount);
    subtotal += amt;
    const disp = it.amount? String(it.amount).replace(/^Rp\s*/i,'') : '(tidak tercantum)';
    console.log(`${it.label}: Rp ${disp}`);
  }
  console.log('\nSubtotal biaya awal masuk: '+fmt(subtotal));
  const dppDisc = parseAmt(fee.dppDiscount);
  if(dppDisc) console.log('\nPotongan biaya DPP: '+fmt(dppDisc));
  const totalAfter = Math.max(0, subtotal - dppDisc);
  console.log('\nTotal biaya awal masuk setelah potongan: '+fmt(totalAfter));
  console.log('\n');
}
