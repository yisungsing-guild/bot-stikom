const fs = require('fs');
const lines = fs.readFileSync('./tmp_query_batch_outputs.jsonl','utf8').trim().split(/\r?\n/).filter(Boolean);
function parseAmt(s){ if(!s) return null; const m = String(s).match(/([0-9][0-9\.,]+)/); if(!m) return null; return 'Rp '+m[1].replace(/\./g,'.').replace(/,/g,''); }
function extractOnboarding(rawChunk){ if(!rawChunk) return [];
  const lines = String(rawChunk).replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
  const tokens=['jas','almamater','topi','kaos','tas','gmt','gmti','seragam'];
  const items = [];
  for(const l of lines){
    const m = l.match(/(?:Rp\s*\.?\s*)?([0-9][0-9\.,]+)/);
    if(m){
      const idx = m.index;
      const label = l.substring(0,idx).replace(/^\d+\.?\s*/,'').trim();
      const amt = 'Rp '+m[1];
      if(tokens.some(t=>label.toLowerCase().includes(t))){ items.push({label,amount:amt}); }
    }
  }
  return items;
}

let out='';
for(const L of lines){
  const o = JSON.parse(L);
  out += `--- ${o.query}\n`;
  out += `Final:\n${o.final || o.preDecorate || '(no text)'}\n\n`;
  const f = o.feeStruct;
  if(!f){ out += 'FeeStruct: NO feeStruct\n';
    // try extract rows from preDecorate
    const pd = o.preDecorate || '';
    const rows = (pd.match(/Rp\s*[0-9][0-9\.,]*/g) || []).map(x=>x.replace(/\s+/g,' '));
    out += `Parsed amounts (from answer): ${rows.join(', ') || '(none)'}\n`;
  } else {
    out += 'FeeStruct:\n';
    out += `- registrationFee: ${f.registrationFee || '(none)'}\n`;
    out += `- registrationDiscount: ${f.registrationDiscount || '(none)'}\n`;
    out += `- dpp: ${f.dpp || '(none)'}\n`;
    out += `- dppDiscount: ${f.dppDiscount || '(none)'}\n`;
    out += `- programName: ${f.programName || f.program || '(none)'}\n`;
    const onboard = extractOnboarding(f.rawChunk);
    out += `- onboarding items detected: ${onboard.length>0 ? onboard.map(i=>i.label+': '+i.amount).join(' | ') : '(none)'}\n`;
  }
  out += '\n';
}
fs.writeFileSync('./tmp_query_summary.txt', out);
console.log('Wrote tmp_query_summary.txt');
