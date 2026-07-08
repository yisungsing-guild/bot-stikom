const prisma = require('../db');
const { safeSessionUpsert } = require('../utils/sessionUpsert');

// Engine FSM sederhana untuk sistem menu yang didorong angka (1,2,3...)
// Tujuan: menyederhanakan navigasi menu berbasis numeric dan menyimpan
// state percakapan pada tabel `Session`.

// handleFSM(chatId, text)
// - chatId: identifier obrolan (mis. nomor WA)
// - text: isi pesan dari user
// Alur:
// 1) Ambil session untuk chatId, default state = 'root'
// 2) Jika input adalah angka murni, coba cocokkan key menu berupa `${state}.${digit}`
//    jika cocok -> update session ke state baru dan kembalikan teks menu.
// 3) Jika tidak ada kecocokan numeric dan state adalah 'root', kembalikan
//    daftar item root yang tersedia (misal untuk menampilkan menu utama).
// 4) Jika tidak ada yang cocok, kembalikan null (biarkan engine lain menanggapi).
async function handleFSM(chatId, text) {
  const session = await prisma.session.findUnique({ where: { chatId } });
  // state saat ini disimpan di session; fallback ke 'root' bila belum ada
  let state = session ? session.state : 'root';

  // Normalisasi input
  const trimmed = String(text || '').trim();

  // Perintah menu/help bisa dipanggil dari state mana pun.
  // Ini juga jadi cara aman untuk "kembali ke menu utama".
  const wantMenu = /^(menu|menu\s+utama|help|bantuan|mulai|start|opsi|pilihan)$/i.test(trimmed);
  if (wantMenu) {
    if (state !== 'root') {
      await upsertSession(chatId, 'root');
      state = 'root';
    }

    const rootItemsAll = await prisma.menuItem.findMany({
      where: { key: { startsWith: 'root.' } },
      orderBy: { order: 'asc' }
    });

    // Hanya tampilkan item level-1: root.<angka>
    const rootItems = (rootItemsAll || []).filter(i => /^root\.\d+$/.test(String(i.key || '')));
    if (rootItems.length) {
      const lines = rootItems.map((i) => {
        const key = String(i.key || '');
        const digit = key.split('.').pop();
        const firstLine = String(i.text || '').split(/\r?\n/)[0].trim();
        const label = firstLine || String(i.text || '').trim();
        return `${digit}. ${label}`;
      });
      return lines.join('\n');
    }
  }

  // Jika user memasukkan angka saja -> interpretasikan sebagai pilihan menu
  if (/^\d+$/.test(trimmed)) {
    // Bentuk key menu disusun seperti 'root.1' atau 'root.2' atau 'root.1.3' dsb
    const key = `${state}.${trimmed}`;
    const menu = await prisma.menuItem.findFirst({ where: { key } });
    if (menu) {
      // Simpan state baru ke session
      await upsertSession(chatId, key);
      
      // Jika ada followupPrompt, append ke teks menu
      let reply = menu.text || '';
      if (menu.followupPrompt) {
        reply = reply.trim() + '\n\n' + String(menu.followupPrompt).trim();
      }
      
      // Kembalikan teks yang telah disimpan untuk pilihan tersebut
      return reply;
    }
  }

  // Bila tidak ada input numeric dan kita berada di root,
  // tampilkan daftar item root (menu utama) HANYA jika user memang meminta menu.
  if (state === 'root') {
    // Kompat: sebelumnya menu hanya bisa ditampilkan di root.
    // Sekarang sudah ditangani di blok wantMenu di atas.
  }

  // Tidak ada jawaban dari FSM
  return null;
}

// upsertSession: buat atau perbarui session untuk chatId
// - menyimpan state saat ini dan optional data (JSON)
async function upsertSession(chatId, state, data) {
  // PENTING: jangan menimpa Session.data kecuali caller memang memberikan data.
  // Session.data dipakai untuk chat log, follow-ups, dan flag handover.
  const hasData = data !== undefined;

  const createPayload = hasData ? { chatId, state, data } : { chatId, state };
  const updatePayload = hasData ? { state, data } : { state };

  await safeSessionUpsert(prisma, { where: { chatId }, create: createPayload, update: updatePayload });
}

module.exports = { handleFSM, upsertSession };
