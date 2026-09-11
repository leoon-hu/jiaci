import { z } from "zod";
import { withUser, ok, readJson, ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { destroySession } from "@/lib/auth";

/** 注销：立即不可登录，标记 deleted_at；30 天后由定时任务物理删除（需求 4.3） */
export const POST = withUser(async (req, _ctx, user) => {
  const { email } = z.object({ email: z.string() }).parse(await readJson(req));
  if (email.trim().toLowerCase() !== user.email) throw new ApiError(400, "邮箱不匹配");
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  await destroySession();
  return ok({ deleted: true, purgeAfterDays: 30 });
});
