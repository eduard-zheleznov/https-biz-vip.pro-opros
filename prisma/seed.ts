import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { UserRole, UserStatus } from "../src/generated/prisma/enums";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function main() {
  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL ?? "info@biz-vip.ru";
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? "12345678";
  const adminPasswordHash = await bcrypt.hash(adminPassword, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      forcePasswordChange: true,
      displayName: "Главный администратор",
    },
    create: {
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      forcePasswordChange: true,
      displayName: "Главный администратор",
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
