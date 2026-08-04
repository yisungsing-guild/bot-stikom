const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

async function createUser(username, password, role, displayName) {
  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.adminUser.upsert({
    where: { username },
    update: {
      displayName,
      role,
    },
    create: {
      username,
      displayName,
      role,
      passwordHash,
    },
  });

  console.log(`✓ ${username} created`);
}

async function main() {
  await createUser(
    "wakil_rektor",
    "Fw9lflVto6qPCcpm",
    "superadmin",
    "WAKIL REKTOR III BIDANG PEMASARAN, KEMAHASISWAAN, DAN URUSAN INTERNASIONAL"
  );

  await createUser(
    "direktur",
    "ZKUcFmJBocDZh2hl",
    "superadmin",
    "DIR PEMASARAN DAN HUMAS"
  );

  await createUser(
    "Falkultas_BISVOK",
    "o2SMcQrphxEUjB1L",
    "admin",
    "FAKULTAS BISNIS DAN VOKASI"
  );

  await createUser(
    "Falkultas_INFOKOM",
    "o2SMcQrphxEUjB1L",
    "admin",
    "FAKULTAS INFORMATIKA DAN KOMPUTER"
  );

await createUser(
    "sistem_informasi",
    "o2SMcQrphxEUjB1L",
    "admin",
    "SISTEM INFORMASI"
  );

  await createUser(
    "sistem_komputer",
    "o2SMcQrphxEUjB1L",
    "admin",
    "SISTEM KOMPUTER"
  );

  await createUser(
    "teknologi_informasi",
    "o2SMcQrphxEUjB1L",
    "admin",
    "TEKNOLOGI INFORMASI"
  );

await createUser(
    "bisnis_digital",
    "o2SMcQrphxEUjB1L",
    "admin",
    "BISNIS DIGITAL"
  );

  await createUser(
    "manajemen_informatika",
    "o2SMcQrphxEUjB1L",
    "admin",
    "MANAJEMEN INFORMATIKA"
  );

  await createUser(
    "pasca",
    "o2SMcQrphxEUjB1L",
    "admin",
    "PASCA SARJANA SISTEM INFORMASI"
  );

  await createUser(
    "international",
    "ITGWbCB3Lf3YSh3n",
    "admin",
    "DIR URUSAN INTERNASIONAL"
  );

   await createUser(
    "akademik",
    "BHpgty2Xw5glPwbp",
    "admin",
    "DIR AKADEMIK"
   )

  await createUser(
    "kerjasama",
    "ivsH2GcgMAoEAlY0",
    "admin",
    "DIR KERJASAMA, LAYANAN INDUSTRI, DAN INKUBATOR BISNIS"
  );

  await createUser(
    "kemahasiswaan",
    "rsLI29mnecmbd461",
    "admin",
    "DIR KEMAHASISWAAN, KARIER, DAN ALUMNI"
  );
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });