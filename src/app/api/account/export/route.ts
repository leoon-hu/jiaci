import { withUser } from "@/lib/api";
import { exportUserData } from "@/lib/study";

export const GET = withUser(async (_req, _ctx, user) => {
  const data = await exportUserData(user.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="aiword-export-${data.exportedAt.slice(0, 10)}.json"` },
  });
});
