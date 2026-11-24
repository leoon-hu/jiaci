import { z } from "zod";
import { handle, ok, readJson, fail } from "@/lib/api";
import { createSession, verifyOtp } from "@/lib/auth";
import { getAuthMode } from "@/lib/auth-mode";

export const POST = handle(async (req) => {
  // No OTP verification or implicit registration in private mode.
  if (getAuthMode() !== "email") return fail(404, "接口不可用", "not_found");
  const { email, code } = z.object({ email: z.string(), code: z.string().regex(/^\d{6}$/, "验证码为 6 位数字") }).parse(await readJson(req));
  const r = await verifyOtp(email, code);
  await createSession(r.userId);
  return ok({ userId: r.userId, isNew: r.isNew });
});
