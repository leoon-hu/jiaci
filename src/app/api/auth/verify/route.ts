import { z } from "zod";
import { handle, ok, readJson } from "@/lib/api";
import { createSession, verifyOtp } from "@/lib/auth";

export const POST = handle(async (req) => {
  const { email, code } = z.object({ email: z.string(), code: z.string().regex(/^\d{6}$/, "验证码为 6 位数字") }).parse(await readJson(req));
  const r = await verifyOtp(email, code);
  await createSession(r.userId);
  return ok({ userId: r.userId, isNew: r.isNew });
});
