import { z } from "zod";
import { withUser, ok, readJson, ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";

export const PUT = withUser(async (req, _ctx, user) => {
  const { wordbookId } = z.object({ wordbookId: z.string() }).parse(await readJson(req));
  const book = await prisma.wordbook.findFirst({ where: { id: wordbookId, OR: [{ type: "builtin" }, { ownerId: user.id }] } });
  if (!book) throw new ApiError(404, "词库不存在");
  await prisma.userCurrentWordbook.upsert({ where: { userId: user.id }, update: { wordbookId }, create: { userId: user.id, wordbookId } });
  return ok({ currentId: wordbookId, name: book.name });
});
