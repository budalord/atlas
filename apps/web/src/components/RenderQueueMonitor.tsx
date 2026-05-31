import { MonitorCog, ChevronDown, Play, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import type { ApiEnvelope, Screen } from "../types";

type Row = { module: string; id: string; name: string };

/**
 * 双轨设计 · 渲染工作队列监控(取代旧 codex 任务触发)。
 *
 * codex 生产出图已砍 —— 出图由 Atlas/Claude 用冻结壳渲染收口(render-and-submit)。
 * 本面板就是"做事那个 agent(Atlas/Claude)"的工作队列实时状态:
 *   - 待渲染队列: needs_prototype=true 的屏(点过"重新出图", 等 Atlas 渲染)
 *   - 待审 inbox: pending_prototype 的屏(已渲, 等人 approve/reject)
 * 数据复用 GET /screens; useDataChange 自动刷新。
 */
export function RenderQueueMonitor({ productId }: { productId: string }) {
  const [needs, setNeeds] = useState<Row[]>([]);
  const [pending, setPending] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);
  const [drainMsg, setDrainMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/screens`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<Screen[]>;
      const pick = (s: Screen): Row => ({ module: s.module, id: s.id, name: s.name });
      setNeeds(json.data.filter((s) => s.needs_prototype).map(pick));
      setPending(json.data.filter((s) => s.pending_prototype).map(pick));
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChange(() => {
    void load();
  });

  const drain = useCallback(async () => {
    if (draining) return;
    setDraining(true);
    setDrainMsg(null);
    try {
      const res = await fetch(`/api/products/${productId}/screens/render-queue`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { data?: { rendered: number }; error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDrainMsg(`已渲染 ${body.data?.rendered ?? 0} 屏 → 待审`);
      await load();
    } catch (e) {
      setDrainMsg(e instanceof Error ? e.message : "渲染失败");
    } finally {
      setDraining(false);
    }
  }, [draining, productId, load]);

  const chip = (n: number, tone: string) =>
    `inline-flex min-w-[18px] items-center justify-center rounded px-1 text-[11px] font-semibold ${tone}`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Atlas/Claude 渲染工作队列(取代旧 codex 任务队列)"
        className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-600 transition hover:bg-slate-100"
      >
        <MonitorCog size={14} className="text-slate-500" />
        <span className="font-medium text-slate-700">渲染监控</span>
        <span className="flex items-center gap-1">
          <span className="text-slate-400">待渲染</span>
          <span className={chip(needs.length, needs.length ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-400")}>
            {needs.length}
          </span>
        </span>
        <span className="flex items-center gap-1">
          <span className="text-slate-400">待审</span>
          <span className={chip(pending.length, pending.length ? "bg-violet-100 text-violet-800" : "bg-slate-100 text-slate-400")}>
            {pending.length}
          </span>
        </span>
        <ChevronDown size={13} className={`text-slate-400 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-md border border-slate-200 bg-white p-3 text-xs shadow-lg">
          {err ? <div className="mb-2 text-red-600">加载失败: {err}</div> : null}

          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-amber-800">
              <span className="h-2 w-2 rounded-full bg-amber-400" /> 待渲染队列 · {needs.length}
            </div>
            {needs.length > 0 ? (
              <button
                type="button"
                onClick={drain}
                disabled={draining}
                className="inline-flex items-center gap-1 rounded bg-slate-950 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-slate-800 disabled:opacity-60"
              >
                {draining ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
                {draining ? "渲染中…" : "渲染全部待出图"}
              </button>
            ) : null}
          </div>
          {drainMsg ? <div className="mb-1.5 text-[11px] text-emerald-700">{drainMsg}</div> : null}
          {needs.length === 0 ? (
            <div className="mb-3 pl-3.5 text-slate-400">(空)</div>
          ) : (
            <ul className="mb-3 space-y-0.5 pl-3.5">
              {needs.map((r) => (
                <li key={`${r.module}/${r.id}`} className="text-slate-600">
                  {r.name} <span className="text-slate-400">· {r.module}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mb-1 flex items-center gap-1.5 font-semibold text-violet-800">
            <span className="h-2 w-2 rounded-full bg-violet-400" /> 待审 inbox · {pending.length}
          </div>
          {pending.length === 0 ? (
            <div className="mb-2 pl-3.5 text-slate-400">(空)</div>
          ) : (
            <ul className="mb-2 space-y-0.5 pl-3.5">
              {pending.map((r) => (
                <li key={`${r.module}/${r.id}`} className="text-slate-600">
                  {r.name} <span className="text-slate-400">· {r.module}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] leading-relaxed text-slate-400">
            出图由 Atlas/Claude 用冻结壳渲染收口(render-and-submit),不再走 codex。
            「重新出图」只把屏标入待渲染队列。
          </div>
        </div>
      ) : null}
    </div>
  );
}
