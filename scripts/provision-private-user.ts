import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { getPrivateUserEmails } from "../src/lib/auth-mode";

const db = new PrismaClient();
async function main() {
  const emails = getPrivateUserEmails();
  const version = (await db.systemConfig.findUnique({ where: { key: "legal.version" } }))?.value ?? "1";
  const termsAcceptedAt = new Date();
  const users = await db.$transaction(async (tx) => {
    await tx.user.createMany({
      data: emails.map((email) => ({ email, termsVersion: version, termsAcceptedAt })),
      skipDuplicates: true,
    });
    const accounts = await tx.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true, deletedAt: true },
    });
    const deleted = accounts.find((user) => user.deletedAt);
    if (deleted) throw new Error(`私有账号 ${deleted.email} 已被注销，请检查密钥绑定`);
    return accounts;
  });
  for (const user of users) console.log(`Private account ready: ${user.email} (${user.id})`);
}
main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
