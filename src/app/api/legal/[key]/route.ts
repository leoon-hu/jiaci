import { handle, ok, fail, type Params } from "@/lib/api";
import { getConfig } from "@/lib/config";

const KEYS: Record<string, string> = { privacy: "legal.privacy_policy", terms: "legal.terms" };

export const GET = handle(async (_req, ctx: Params<{ key: string }>) => {
  const { key } = await ctx.params;
  if (!KEYS[key]) return fail(404, "页面不存在");
  return ok({ key, markdown: await getConfig(KEYS[key]) });
});
