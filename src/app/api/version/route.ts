/**
 * 服务端正在跑的是哪一版（需求 3.5 设置「关于 → 版本」的「检查更新」）：构建时内联的 NEXT_PUBLIC_APP_VERSION。
 * 不要登录、不碰数据库；no-store，浏览器与 CDN 都不缓存。
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ version: process.env.NEXT_PUBLIC_APP_VERSION ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
