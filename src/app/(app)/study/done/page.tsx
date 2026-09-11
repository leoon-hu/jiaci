"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import { IconCheck } from "@/components/Icons";
import "./done.css";

function Done() {
  const p = useSearchParams();
  const extra = p.get("extra") === "1";
  const n = Number(p.get("new") ?? 0), r = Number(p.get("review") ?? 0), rate = p.get("rate") ?? "—";
  return (
    <main className="done-wrap">
      <div className="done-icon"><IconCheck /></div>
      <h1 className="done-title">{extra ? "这一组学完了" : "今日任务已完成"}</h1>
      <p className="done-sub">{extra ? "额外学习的新词明天会安排复习" : "坚持每天学一点，明天见 👋"}</p>
      <div className="recap">
        <div className="stat hi"><b>{n}</b><span>新词</span></div>
        <div className="stat"><b>{r}</b><span>复习</span></div>
        <div className="stat ok"><b>{rate}</b><span>认识率</span></div>
      </div>
      <Link className="btn btn-primary btn-lg btn-block" href="/home">返回首页</Link>
      <div className="again">
        <h4>还有精力？再学一组</h4>
        <p>额外学习一组新词，不影响明天的计划。</p>
        <Link className="btn btn-secondary btn-block" href="/study?extra=1">再学一组</Link>
      </div>
    </main>
  );
}

export default function DonePage() {
  return <AppShell nav="study"><Suspense><Done /></Suspense></AppShell>;
}
