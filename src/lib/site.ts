/**
 * 站点对外地址：分享卡片（og:image）、robots、sitemap 里的绝对地址都从这里拼。
 * 静态预渲染的页面（登录页、robots.txt、sitemap.xml）在**构建时**就把地址写死了，动态页在请求时才算，
 * 所以构建机与运行机都得能读到：SITE_URL 优先（完整地址，构建机上配），其次按 SITE_HOST 拼 https（运行机上本来就有），
 * 都没有就当本机开发。
 */
export function siteUrl(): string {
  const url = process.env.SITE_URL?.trim().replace(/\/+$/, "");
  if (url) return url;
  const host = process.env.SITE_HOST?.trim();
  return host ? `https://${host}` : `http://localhost:${process.env.PORT ?? 3000}`;
}
