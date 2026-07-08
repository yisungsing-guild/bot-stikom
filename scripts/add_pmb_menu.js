const prisma = require('../src/db');

async function upsertMenu(key, text, order) {
  // Try find existing
  const existing = await prisma.menuItem.findUnique({ where: { key } }).catch(() => null);
  if (existing) {
    console.log('Exists:', key);
    return existing;
  }

  const created = await prisma.menuItem.create({ data: { key, text, order } });
  console.log('Created:', key);
  return created;
}

async function setWelcomeMessage(value) {
  const s = await prisma.setting.upsert({
    where: { key: 'welcome_message' },
    create: { key: 'welcome_message', value },
    update: { value }
  });
  console.log('Welcome message set');
  return s;
}

(async () => {
  try {
    await upsertMenu('root.1', 'Penerimaan Mahasiswa Baru (PMB)', 1);
    await upsertMenu('root.1.1', 'Informasi Umum', 1);
    await upsertMenu('root.1.2', 'Jadwal & Alur Pendaftaran', 2);
    await upsertMenu('root.1.3', 'Biaya & Beasiswa', 3);
    await upsertMenu('root.1.4', 'Syarat & Dokumen', 4);
    await upsertMenu('root.1.5', 'Kontak PMB', 5);

    const welcome = `Halo! 👋\nSelamat datang di layanan informasi ITB STIKOM Bali.\n\nKetik 1 untuk informasi PMB, 2 untuk Program Studi, atau ketik pertanyaan Anda.\n\nTerima kasih 😊`;
    await setWelcomeMessage(welcome);

    console.log('Done.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
})();
