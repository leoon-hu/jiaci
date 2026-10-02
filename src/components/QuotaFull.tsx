"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { quotaFullMessage, type BookQuota } from "@/lib/wordbook-quota";

/**
 * 「我的词库」有几本、最多几本（3.3.1）：新建词库页、导入页一进来就查，满了直接说，不等填完表单才被接口拒绝。
 * 取的是首页同款的轻量列表（只算当前词库的进度）；取不到就当没满，接口那头还会再拦
 */
export function useBookQuota(): BookQuota | null {
  const [q, setQ] = useState<BookQuota | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ quota: BookQuota }>("/api/wordbooks?scope=current").then((r) => { if (alive) setQ(r.quota); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return q;
}

/** 满了之后顶替新建 / 导入表单的那一块 */
export default function QuotaFull({ max }: { max: number }) {
  return (
    <div className="empty quota-full">
      <div className="icon">📚</div>
      <p>{quotaFullMessage(max)}。</p>
      <Link className="btn btn-primary mt-12" href="/wordbooks">去词库</Link>
    </div>
  );
}
