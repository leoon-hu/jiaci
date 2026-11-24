import "dotenv/config";
import { PrismaClient } from "@prisma/client";

async function main() {
  if (process.env.CONFIRM_CLEAR_SESSIONS !== "YES") {
    throw new Error("Set CONFIRM_CLEAR_SESSIONS=YES to revoke all active sessions");
  }
  const db = new PrismaClient();
  try {
    const result = await db.session.deleteMany({});
    console.log(`Revoked ${result.count} sessions`);
  } finally {
    await db.$disconnect();
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
