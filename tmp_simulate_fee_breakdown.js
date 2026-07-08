const fs = require('fs');
const fullIndex = JSON.parse(fs.readFileSync('src/data/rag_index.json','utf8'));
const question = 'biaya lengkap prodi si ada apa saja?';
const currentQ = question;
const qLower = String(currentQ || '').toLowerCase();
const mentionsCostCore = /(biaya|rincian|detail|komponen|lainnya|potongan|diskon|dpp|ukt|per\s*semester|biaya\s*semester|uang\s+semester|biaya\s+per\s*semester|pembayaran|cicil|cicilan|\brp\b|rupiah)/i.test(qLower);
const mentionsRegistrationFee = /(pendaftaran|registrasi)/i.test(qLower) && (mentionsCostCore || /(berapa|nominal|tarif|uang)/i.test(qLower));
const mentionsRequirements = /(syarat|persyaratan|dokumen|berkas|formulir|lampiran)/i.test(qLower);
const asksCost = mentionsCostCore || mentionsRegistrationFee;
const wantsOtherOnly = /\b(lainnya|selain\s+itu|yang\s+lain)\b/i.test(qLower);
const wantsDiscount = /\b(potongan|diskon)\b/i.test(qLower);
const wantsSemesterOnly = /(?:\bukt\b|per\s*semester|biaya\s+semester|uang\s+semester|biaya\s+kuliah|uang\s+kuliah|biaya\s+pendidikan|biaya\s+per\s*semester)/i.test(qLower) && !wantsOtherOnly && !/(rincian|detail|komponen|lengkap|biaya\s+lain|selain\s+itu|yang\s+lain|dpp|pendaftaran|registrasi|jas|kaos|pengalaman\s+industri|total|cicil|cicilan|skema\s+pembayaran|pembayaran\s+per\s+komponen)/i.test(qLower);
console.log({mentionsCostCore,mentionsRegistrationFee,mentionsRequirements,asksCost,wantsOtherOnly,wantsDiscount,wantsSemesterOnly});
if (mentionsRequirements && !mentionsCostCore) return console.log('reject requirements');
if (!asksCost) return console.log('reject not asksCost');
if (/(jadwal|testing|test\b|pengumuman|registrasi\s+ulang|daftar\s+ulang|tanggal)/i.test(qLower)) return console.log('reject schedule');

const detectProgramKey = (textLower) => {
  if (/sistem\s+komputer|\bprodi\s*sk\b|\bjurusan\s*sk\b/i.test(textLower)) return 'sk';
  if (/manajemen\s+informatika|informat(i)?c\s*diploma|\bprodi\s*mi\b|\bjurusan\s*mi\b/i.test(textLower)) return 'mi';
  if (/sistem\s+informasi|\bprodi\s*si\b|\bjurusan\s*si\b/i.test(textLower)) return 'si';
  if (/teknologi\s+informasi|\bprodi\s*ti\b|\bjurusan\s*ti\b/i.test(textLower)) return 'ti';
  if (/bisnis\s+digital|\bprodi\s*bd\b|\bjurusan\s*bd\b/i.test(textLower)) return 'bd';
  if (/\b(biaya|dpp|pendaftaran|registrasi|semester|per\s*semester|pembayaran)\b/i.test(textLower)) {
    const m = /\b(si|ti|bd|sk|mi)\b/i.exec(textLower);
    if (m && m[1]) return m[1].toLowerCase();
  }
  return null;
};
let programKey = detectProgramKey(qLower);
console.log('programKey', programKey);
if (!programKey) {
  const currentHasAnyProgramSignal = /(sistem\s+informasi|teknologi\s+informatika|bisnis\s+digital|sistem\s+komputer|manajemen\s+informatika|\b(si|ti|bd|sk|mi)\b)/i.test(qLower);
  const ambiguousCurrent = !currentHasAnyProgramSignal && qLower.length <= 32;
  if (ambiguousCurrent) {
    programKey = detectProgramKey(question.toLowerCase());
  }
}
console.log('programKey after ambiguous', programKey);
const fullIndexChunks = fullIndex;
const keyRe = /(PROGRAM\s*STUDI\s*SISTEM\s*KOMPUTER|PROGRAMSTUDISISTEMKOMPUTER|PROGRAM\s*STUDI\s*SISTEM\s*INFORMASI|PROGRAMSTUDISISTEMINFORMASI|TEKNOLOGI\s*INFORMASI|TEKNOLOGIINFORMASI|BISNIS\s*DIGITAL|BISNISDIGITAL)/i;
const feeSignalRe = /(?:RINCIAN\s*BIAYA\s*PENDIDIKAN|RINCIANBIAYAPENDIDIKAN|No\.\s*Jenis\s*Biaya|Waktu\s*Pembayaran|Biaya\s*Pendaftaran|Dana\s*Pendidikan\s*Pokok|\bDPP\b|UKT|Biaya\s*Pendidikan\s*Per\s*Semester|Biaya\s*Semester)/i;
const idCounts = new Map();
const idHasFeeSignal = new Map();
for (const item of fullIndexChunks) {
  const chunk = item && item.chunk ? String(item.chunk) : '';
  const trainingId = item && item.trainingId ? String(item.trainingId) : '';
  if (!chunk || !trainingId) continue;
  if (!keyRe.test(chunk)) continue;
  const hasFeeSignal = feeSignalRe.test(chunk);
  if (hasFeeSignal) idHasFeeSignal.set(trainingId, true);
  if (!hasFeeSignal) continue;
  const prev = idCounts.get(trainingId) || 0;
  const bonus = /\bPendaftaran\b/i.test(chunk) ? 2 : 0;
  idCounts.set(trainingId, prev + 1 + bonus);
}
let bestTid=null,bestScore=-1;
for (const [tid,score] of idCounts) { if (score>bestScore) { bestScore=score; bestTid=tid; } }
console.log({bestTid,bestScore});
let candidates = [];
if (bestTid) candidates = fullIndexChunks.filter(item => item && String(item.trainingId||'') === bestTid).map(item => String(item.chunk || ''));
console.log('candlen', candidates.length);
const combined = candidates.join('\n');
const flat = combined.replace(/\\n/g,'\n').replace(/[\r\n]+/g,'\n');
const rawLines = flat.replace(/\r\n/g,'\n').split('\n').map(l=>String(l||'').trim()).filter(Boolean);
console.log('rawLines', rawLines.length, rawLines.slice(60,90));
const expand = (token) => {
  const s=String(token||'').trim(); if(!s) return [];
  const stuckDot=/^([0-9]{1,2})\.(?=[A-Za-z\p{L}])(\S.+)$/u.exec(s);
  if(stuckDot && stuckDot[1] && stuckDot[2]) return([`${stuckDot[1]}.`, String(stuckDot[2]).trim()]);
  const stuckParen=/^([0-9]{1,2})\)(?=[A-Za-z\p{L}])(\S.+)$/u.exec(s);
  if(stuckParen && stuckParen[1] && stuckParen[2]) return([`${stuckParen[1]}.`, String(stuckParen[2]).trim()]);
  return [s];
};
const splitLabelAmountTail = (token)=>{ const s=String(token||'').trim(); if(!s) return []; const m=/^(.+?)(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})$/.exec(s); if(!m||!m[1]||!m[2]) return [s]; const left=String(m[1]).trim(); const right=String(m[2]).trim(); if(left.length<3) return [s]; if(/^(rp\.?|idr)$/i.test(left)) return [s]; if(!/[A-Za-z\p{L}]/u.test(left)) return [s]; return [left,right]; };
const expandedLines=[];
for(const l of rawLines){ const parts=expand(l); for(const p of parts){ const more=splitLabelAmountTail(p); for(const x of more){ const t=String(x||'').trim(); if(t) expandedLines.push(t);} }}
console.log('expandedLines', expandedLines.length, expandedLines.slice(65,85));
const isNumberStart = s=>/^\d+\.?$/.test(String(s||'').replace(/\s+/g,''));
const looksLikePhoneNumber=d=>{ const dt=String(d||'').trim(); if(!dt) return false; if(/^0\d{8,}$/.test(dt)) return true; if(/^62\d{8,}$/.test(dt)) return true; return false; };
const looksLikeAmount=s=>{ const tok=String(s||'').trim(); if(!tok) return false; if(/^\d{1,3}(?:\.\d{3})+(?:,\-)?$/.test(tok)) return true; if(/^\d{6,}$/.test(tok)){ if(looksLikePhoneNumber(tok)) return false; return true;} return false; };
const normalizeAmount=s=>String(s||'').trim().replace(/,\-$/g,'');
const parseInlineRow=(rawLine)=>{ const line=String(rawLine||'').replace(/\s{2,}/g,' ').trim(); if(!line) return null; const reNumbered=/^(\d+)\.?\s*[\)\.]\s*(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})(?:\s+(.*))?$/; const reDashed=/^(?:[-ΓÇó]+)\s*(.+?)\s+(\d{1,3}(?:\.\d{3})+(?:,\-)?|\d{6,})(?:\s+(.*))?$/; const m1=reNumbered.exec(line); if(m1){ const label=String(m1[2]||'').trim().replace(/^[ΓÇö\-]+\s*/g,'').trim(); const amount=normalizeAmount(m1[3]); const timing=String(m1[4]||'').trim(); if(!label||!amount)return null; return {label,amount,timing}; } const m2=reDashed.exec(line); if(m2){ const label=String(m2[1]||'').trim().replace(/^[ΓÇö\-]+\s*/g,'').trim(); const amount=normalizeAmount(m2[2]); const timing=String(m2[3]||'').trim(); if(!label||!amount) return null; return {label,amount,timing}; } return null; };
const stopWords=/^(Penjelasan\s*Tambahan\s*:|PenjelasanTambahan\s*:|Potongan\s*Biaya\s*Pendaftaran\s*:|PotonganBiayaPendaftaran\s*:)/i;
const tableTokens=[];
const inlineItems=[];
for(let li=0;li<rawLines.length;li++){ const l=rawLines[li]; const next=String(rawLines[li+1]||'').trim(); if(stopWords.test(l)) break; if(/^Penjelasan$/i.test(l)&&/^Tambahan/i.test(next)) break; if(/^Potongan$/i.test(l)&&/^Biaya/i.test(next)) break; if(/^(No\.|No|Jenis|Biaya|Rp|Waktu|Pembayaran)$/i.test(l)) continue; if(/^T\.?A\b/i.test(l)) continue; const inline=parseInlineRow(l); if(inline){ inlineItems.push(inline); continue; } tableTokens.push(l); }
console.log('tableTokens', tableTokens.length, 'inlineItems', inlineItems.length);
const items=[];
const isLikelyFeeLabel=(rawLabel)=>{ const label=String(rawLabel||'').trim(); if(!label) return false; const lower=label.toLowerCase(); if(/(\bhotline\b|\bfax\b|\bemail\b|\bwebsite\b|\bweb\b|\bkampus\b|\bjl\b|\bjln\b|\bjalan\b|\bph\b\s*:?|\btelepon\b|\btelp\b)/i.test(lower)) return false; if(/(\bdipindai\b|camscanner|always\s+the\s+first)/i.test(lower)) return false; if(/(surat\s+keputusan|lampiran\b|tanggal\b|nomor\b|rektor\b|wakil\b)/i.test(lower)) return false; if(/(pendaftaran|dana|biaya|dpp|registrasi|pendidikan|semester|almamater|gmti|kaos|tas|topi|pengalaman|industri|bahasa|ujian|subject|sertifikasi|yudisium|wisuda|transfer|laptop|perwalian|iuran|kemahasiswaan)/i.test(lower)) return true; return false; };
const normalizeFeePhrase=(s)=>{ if(!s) return ''; let out=String(s||'').trim(); const humanizeOcrConcat=(v)=>{ let t=String(v||''); if(!t) return t; t=t.replace(/([A-Za-z])([0-9])/g,'$1 $2').replace(/([0-9])([A-Za-z])/g,'$1 $2').replace(/([a-z])([A-Z])/g,'$1 $2'); return t; };
 out=out.replace(/DanaPendidikanPokok\s*\(\s*DPP\s*\)/gi,'Dana Pendidikan Pokok (DPP)'); out=out.replace(/DanaPendidikanPokok/gi,'Dana Pendidikan Pokok'); out=out.replace(/BiayaPendidikanPerSemester/gi,'Biaya Pendidikan Per Semester'); out=out.replace(/(?:Biaya\s*)?Pendidikan\s*&\s*Ujian\s*\/\s*Subject/gi,'Biaya Pendidikan per semester'); out=out.replace(/BiayaPengalamanIndustri/gi,'Biaya Pengalaman Industri'); out=out.replace(/Biaya\s*Pengalaman\s*Industri/gi,'Biaya Pengalaman Industri'); out=out.replace(/Jas\s*Alamater/gi,'Jas Almamater'); out=out.replace(/Kaos\s*,\s*Tas\s*,\s*GMTI/gi,'Kaos, Tas, GMTI'); out=out.replace(/Kaos\s*,\s*Topi\s*,\s*GMTI/gi,'Kaos, Topi, GMTI'); out=out.replace(/Saat\s*Registrasi\s*I/gi,'Saat Registrasi I'); out=out.replace(/Pada\s*Saat\s*Daftar/gi,'Pada Saat Daftar'); out=out.replace(/Menjelang\s*Perwalian/gi,'Menjelang Perwalian'); out=out.replace(/Kecuali\s*Reg\s*1/gi,'Kecuali Reg 1'); out=out.replace(/\bReg\s*1\b/gi,'Reg 1'); out=out.replace(/\bReg1\b/gi,'Reg 1'); out=out.replace(/Dicicil\s*Per\s*Bln/gi,'Dicicil per bulan'); out=out.replace(/Dicicil\s*2\s*Kali/gi,'Dicicil 2 kali'); out=out.replace(/Dicicil2Kali/gi,'Dicicil 2 kali'); out=out.replace(/dicicil2kali/gi,'dicicil 2 kali'); out=out.replace(/Dicicil\s*5\s*Kali\s*Per\s*Semester/gi,'Dicicil 5 kali per semester'); out=out.replace(/Dicicil5KaliPerSemester/gi,'Dicicil 5 kali per semester'); out=out.replace(/PerSemester/gi,'Per Semester'); out=out.replace(/s\.d\s*UTS-?1/gi,'s/d UTS-1'); out=out.replace(/s\/d\s*UTS-?1/gi,'s/d UTS-1'); out=out.replace(/s\/d\s*UTS\b/gi,'s/d UTS'); out=out.replace(/s\.d\s*UTS\b/gi,'s/d UTS'); out=out.replace(/s\/dUTS\b/gi,'s/d UTS'); out=out.replace(/s\.dUTS\b/gi,'s/d UTS'); out=out.replace(/Reg\s*1\s*Dicicil/gi,'Reg 1, dicicil'); out=out.replace(/Reg\s*1\s*dicicil/gi,'Reg 1, dicicil'); out=out.replace(/Reg\s*1Dicicil/gi,'Reg 1, dicicil'); out=out.replace(/\bKecuali\s*Reg\s*1\s*,?\s*dicicil\b/gi,'Kecuali Reg 1, dicicil'); out=out.replace(/\bKecuali\s*Reg\s*1\s*dicicil\b/gi,'Kecuali Reg 1, dicicil'); out=out.replace(/\bReg\s*1\s*Dicicil\s*2\s*kali\b/gi,'Reg 1, dicicil 2 kali'); out=out.replace(/\bReg\s*1\s*Dicicil\s*2\s*kali\b/gi,'Reg 1, dicicil 2 kali'); out=out.replace(/\bs\/d\s*(UTS-?1|UTS|September)\b/gi,'s/d $1'); out=out.replace(/s\.d\s*September/gi,'s/d September'); out=out.replace(/s\/d\s*September/gi,'s/d September'); out=out.replace(/DIDIKANMAHASISWABARU\S*/gi,''); out=out.replace(/KELAS\s*REGULER\S*/gi,''); out=out.replace(/PROGRAM\s*STUDI\S*/gi,''); out=out.replace(/PROGRAMSTUDI\S*/gi,''); out=out.replace(/\bT\.\?A\b\s*\d{4}\s*\/?\s*\d{4}\b/gi,''); out=out.replace(/\bNo\.\?\s*Jenis\b[\s\S]*?Waktu\s*Pembayaran\b/gi,''); out=out.replace(/\bJenis\s*Biaya\b/gi,''); out=out.replace(/\bWaktu\s*Pembayaran\b/gi,''); out=out.replace(/\bBiayaRp\b/gi,''); out=out.replace(/\bRp\s*Waktu\b/gi,''); out=humanizeOcrConcat(out); out=out.replace(/\s{2,}/g,' ').trim(); return out; };
for (let li=0;li<tableTokens.length;li++){ const l=tableTokens[li]; if(!isNumberStart(l)) continue; const nTok=parseInt(String(l).replace(/\D/g,'')||'0',10); if(items.length>=4 && nTok>=9) break; const seg=[]; for(let j=li+1;j<rawLines.length;j++){ const t=rawLines[j]; if(isNumberStart(t)){ const prevTok=seg.length?String(seg[seg.length-1]||''):''; if(/registrasi/i.test(prevTok)&&String(t).trim()==='1'){ seg.push(t); continue; } break; } seg.push(t);} const amountIdx = seg.findIndex(looksLikeAmount); if(amountIdx===-1) continue; const segLower = seg.join(' ').toLowerCase(); const extractAmountsFromText = (txt)=>{ const raw=String(txt||''); const found=[]; const re=/([0-9]{1,3}(?:\.[0-9]{3})+(?:,\-)?|[0-9]{6,})/g; let m; while((m=re.exec(raw))!==null){ const v=normalizeAmount(m[1]); if(v) found.push(v); } return found; };
  const allAmounts = Array.from(new Set([ ...seg.filter(looksLikeAmount).map(normalizeAmount), ...extractAmountsFromText(seg.join(' ')) ].filter(Boolean)));
  const mentionsBPI = /biaya\s*pengalaman\s*industri/i.test(segLower) || /pengalaman\s*industri/i.test(segLower);
  const mentionsAllTiers = segLower.includes('internasional') && segLower.includes('nasional') && segLower.includes('lokal');
  if (mentionsBPI && mentionsAllTiers && allAmounts.length >=3) {
    if (allAmounts.length >=3) {
      const sorted = allAmounts.slice(0,6).sort((a,b)=>parseInt(a.replace(/\D/g,''),10)-parseInt(b.replace(/\D/g,''),10));
      const tierMap = [ {tier:'Internasional',amount:sorted[0]}, {tier:'Nasional',amount:sorted[1]}, {tier:'Lokal',amount:sorted[2]} ].filter(x=>x.amount);
      if (tierMap.length===3){ let bpiTiming=''; if(/dicicil/i.test(segLower)){ bpiTiming=/dicicil\s*5\s*kali|dicicil5kali/i.test(segLower)?'Dicicil 5 kali per semester':'Dicicil'; } for (const tm of tierMap){ items.push({ label:`Biaya Pengalaman Industri (${tm.tier})`, amount:tm.amount, timing:bpiTiming }); } continue; }
    }
  }
  const labelParts = seg.slice(0, amountIdx);
  const amountTok = normalizeAmount(seg[amountIdx]);
  const timingParts = seg.slice(amountIdx+1);
  const label = labelParts.join(' ').replace(/[ΓÇ£ΓÇ¥'ΓÇÿΓÇÖ]/g,'').replace(/\s{2,}/g,' ').trim();
  const cleanedLabel = normalizeFeePhrase(label.replace(/\s*[ΓÇö-]\s*$/g,'').trim());
  if (!cleanedLabel) continue;
  if (!isLikelyFeeLabel(cleanedLabel)) continue;
  const timing = normalizeFeePhrase(timingParts.join(' ').replace(/\s{2,}/g,' ').trim());
  items.push({ label: cleanedLabel, amount: amountTok, timing });
}
if(!items.length){ console.log('items empty after parse, inline count', inlineItems.length); if(inlineItems.length){ for(const it of inlineItems){ if(!isLikelyFeeLabel(it.label)) console.log('inline label rejected', it.label); else items.push(it);} console.log('after inline items', items.length);} }
console.log('items', items.length, items.slice(0,20));
