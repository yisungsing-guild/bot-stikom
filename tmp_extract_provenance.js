const fs=require('fs');
const path=require('path');
const data=JSON.parse(fs.readFileSync('tmp_parse_result.json','utf8'));
const raw = (data.result && data.result.rawChunk) ? data.result.rawChunk : (data.result && data.result.sourceChunk && data.result.sourceChunk.chunk) || '';
const lines = String(raw||'').split(/\n/);
function findPattern(list){
  for(const p of list){
    const re = p instanceof RegExp ? p : new RegExp(p, 'i');
    const m = re.exec(raw);
    if(m && m[1]){
      // find the line containing the match
      const idx = raw.indexOf(m[0]);
      const before = raw.slice(0, idx);
      const lineIndex = before.split('\n').length - 1;
      return {value: m[1].trim(), pattern: re.toString(), lineIndex, lineText: lines[lineIndex] || ''};
    }
  }
  return null;
}
const registrationPatterns=[/\b1\s*\.\s*Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i,/(?:^|[\r\n])\s*(?:Biaya\s+)?Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/im,/\bPendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i];
const dppPatterns=[/\b2\s*\.\s*(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i,/(?:Dana\s*Pendidikan\s*Pokok|DanaPendidikanPokok)\s*(?:\(\s*DPP\s*\))?\s*[:–\-]?\s*(?:Rp\.?\s*)?([0-9][0-9.]{0,20})/i];
const regDiscountPatterns=[/Potongan\s+Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i,/Potongan\s*Pendaftaran\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i];
const dppDiscountPatterns=[/Potongan\s+DPP\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i,/Potongan\s+Dana\s+Pendidikan\s+Pokok\s*[:\-–]?\s*(?:Rp\.?\s*)?([0-9][0-9.,\s]{0,30})/i];
const uniformPatterns=[/Jas[^0-9]{0,80}([0-9][0-9.,\s]{0,20})/i,/Topi[^0-9]{0,80}([0-9][0-9.,\s]{0,20})/i,/Kaos[^0-9]{0,80}([0-9][0-9.,\s]{0,20})/i,/Tas[^0-9]{0,80}([0-9][0-9.,\s]{0,20})/i];

const results={};
results.registrationFee=findPattern(registrationPatterns);
results.dpp=findPattern(dppPatterns);
results.registrationDiscount=findPattern(regDiscountPatterns);
results.dppDiscount=findPattern(dppDiscountPatterns);
results.uniforms=[];
for(const p of uniformPatterns){
  const m = p.exec(raw);
  if(m && m[1]){
    const idx=raw.indexOf(m[0]);
    const lineIndex = raw.slice(0, idx).split('\n').length -1;
    results.uniforms.push({name:p.toString(), value:m[1].trim(), lineIndex, lineText: lines[lineIndex]||''});
  }
}
// collect money candidates: tokens with digits and separators
const moneyTokens=[];
const tokenRe=/([0-9]{1,3}(?:[.,\s][0-9]{3})+|[0-9]{3,}|[0-9]{1,9})/g;
let m;
while((m=tokenRe.exec(raw))){
  const token = m[1];
  const digits = token.replace(/[^0-9]/g,'');
  const idx = m.index;
  const lineIndex = raw.slice(0, idx).split('\n').length -1;
  moneyTokens.push({token, digits, lineIndex, lineText: lines[lineIndex]||''});
}
fs.writeFileSync('tmp_provenance_output.json', JSON.stringify({sourceChunkId:data.sourceChunkId, parsed: data.result, provenance: results, moneyTokens}, null,2),'utf8');
console.log('WROTE tmp_provenance_output.json');
