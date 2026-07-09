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
    "ZKUcFmJBocDZh2hl",
    "superadmin",
    "WAKIL REKTOR III"
  );

  await createUser(
    "direktur",
    "ZKUcFmJBocDZh2hl",
    "superadmin",
    "DIR PEMASARAN DAN HUMAS"
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