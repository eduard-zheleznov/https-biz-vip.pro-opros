import "dotenv/config";

import bcrypt from "bcryptjs";

import { UserRole, UserStatus } from "./src/generated/prisma/client";
import { prisma } from "./src/lib/prisma";
import { resetPasswordWithInitialPassword } from "./src/lib/data";

async function main() {
  const email = `codex-reset-test-${Date.now()}@example.com`;
  const previousPassword = "old-password-987";
  const nextPassword = "new-password-987";
  const initialPassword = process.env.DEFAULT_MEMBER_PASSWORD ?? "";

  const passwordHash = await bcrypt.hash(previousPassword, 12);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      forcePasswordChange: false,
    },
  });

  try {
    const result = await resetPasswordWithInitialPassword(email, initialPassword, nextPassword);
    const updated = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });

    const nextMatches = await bcrypt.compare(nextPassword, updated.passwordHash ?? "");
    const previousMatches = await bcrypt.compare(previousPassword, updated.passwordHash ?? "");

    console.log(JSON.stringify({ result, nextMatches, previousMatches }));
  } finally {
    await prisma.session.deleteMany({
      where: { userId: user.id },
    });
    await prisma.user.delete({
      where: { id: user.id },
    });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
