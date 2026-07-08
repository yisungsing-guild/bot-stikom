const fmt = require('./src/utils/whatsappFormatter');
const conv = require('./src/engine/conversationalStyle');

function finalCleanup(src){
  if(!src||typeof src!=='string') return src;
  let out=String(src);
  out = out.replace(/^\s*[-—–]{2,}\s*$/gm, '');
  out = out.replace(/^\s*-\s*-+\s*$/gm, '');
  out = out.replace(/^\s*-\s*--\s*$/gm, '');
  out = out.replace(/^\s*[-\s]{2,}\s*$/gm, '');
  out = out.replace(/^\s*💡.*$/gm, '');
  out = out.replace(/^\s*Mari kita bahas.*$/gim, '');
  out = out.replace(/^\s*Ini informasi mengenai.*$/gim, '');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

const cases = [
  { q: 'apa itu sistem informasi?', raw: 'Halo kak 👋\n\nSistem Informasi adalah program studi yang mempelajari pengumpulan, pengolahan, penyimpanan, dan penyajian informasi menggunakan teknologi.\n\nRekomendasi pertanyaan berikutnya:\n- Apa beda Sistem Informasi dan Teknologi Informasi?\n- Mau info biaya kuliah?\n\nKesimpulannya, Sistem Informasi fokus pada integrasi sistem dan manajemen data.' },
  { q: 'berapa biaya sistem informasi?', raw: 'Halo kak 👋\n\nEstimasi biaya kuliah Sistem Informasi adalah Rp 6.500.000 per semester.\n\nInformasi Terkait:\n- Cek opsi beasiswa\n- Simulasi cicilan\n\nKesimpulannya, total per semester tergantung pada kelas dan potongan beasiswa.' },
  { q: 'akreditasi sistem informasi', raw: 'Halo kak 👋\n\nProgram Studi Sistem Informasi terakreditasi B oleh BAN-PT.\n\nRekomendasi pertanyaan berikutnya:\n- Mau lihat SK akreditasi?\n- Perbedaan akreditasi A vs B?\n\nKesimpulannya, akreditasi B menandakan standar yang baik tetapi periksa SK terbaru.' }
];

for(const c of cases){
  console.log('\n=== QUERY:', c.q, '===');
  console.log('\n-- RAW before buildWhatsappConversationalReply() --\n');
  console.log(c.raw);

  const afterFormatter = fmt.buildWhatsappConversationalReply({ rawMainAnswer: c.raw, userQuery: c.q, includeMeta: true });
  console.log('\n-- AFTER buildWhatsappConversationalReply() --\n');
  console.log(afterFormatter);

  const afterDecorate = conv.decorateBotAnswerText(afterFormatter, c.q);
  console.log('\n-- AFTER decorateBotAnswerText() --\n');
  console.log(afterDecorate);

  const beforeSend = finalCleanup(afterDecorate);
  console.log('\n-- BEFORE sendBotMessageOriginal (finalCleanup) --\n');
  console.log(beforeSend);
}
