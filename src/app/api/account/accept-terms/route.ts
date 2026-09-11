import { withUser, ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getConfig } from "@/lib/config";

/** 记录用户对当前条款版本的同意（审计 F171）：条款正文有实质修改时把 legal.version +1，用户会被提示重新确认 */
export const POST = withUser(async (_req, _ctx, user) => {
  const version = await getConfig("legal.version");
  await prisma.user.update({ where: { id: user.id }, data: { termsVersion: version, termsAcceptedAt: new Date() } });
  return ok({ termsVersion: version });
});
