import Link from "next/link";
import { notFound } from "next/navigation";
import BackLink from "@/components/BackLink";
import { marked } from "marked";
import { getConfig } from "@/lib/config";
import "./legal.css";

const PAGES: Record<string, { title: string; configKey: string }> = {
  privacy: { title: "隐私政策", configKey: "legal.privacy_policy" },
  terms: { title: "服务条款", configKey: "legal.terms" },
};

/**
 * 只渲染 Markdown 本身：正文虽然只有运营方能写，但一旦后台或库被写入就是直接的存储型 XSS 出口，
 * 这里把原始 HTML 转义掉，并挡住 javascript: / data: 链接（审计 F070）。
 */
function renderMarkdown(md: string): string {
  const escaped = md.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = marked.parse(escaped, { async: false });
  return html.replace(/(href|src)\s*=\s*"\s*(javascript|data|vbscript):[^"]*"/gi, '$1="#"');
}

/** 隐私政策 / 服务条款：正文来自 system_config（Markdown），运营方直接改库（需求 4.3） */
export default async function LegalPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const page = PAGES[key];
  if (!page) notFound();
  const md = await getConfig(page.configKey);
  const html = md.trim() ? renderMarkdown(md) : "<p>本页内容尚未发布，请稍后再来。</p>";
  return (
    <div className="legal-wrap">
      <div className="legal-top"><Link className="brand" href="/home"><span className="logo">Ai</span>AI加词</Link><BackLink href="/settings">返回</BackLink></div>
      <article className="doc"><h1>{page.title}</h1><div dangerouslySetInnerHTML={{ __html: html }} /></article>
    </div>
  );
}
