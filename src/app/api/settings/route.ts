import { withUser, ok, readJson } from "@/lib/api";
import { getSettings, saveSettings } from "@/lib/settings";

export const GET = withUser(async (_req, _ctx, user) => ok(await getSettings(user.id)));
export const PUT = withUser(async (req, _ctx, user) => ok(await saveSettings(user.id, await readJson(req))));
