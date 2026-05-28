import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope } from "../types";
import { useDataChange } from "../lib/useDataChange";

interface RecentActivityStripProps {
  productId: string;
  /** 默认 7 天 */
  days?: number;
}

interface HistorySummary {
  count: number;
  byStage: Record<string, number>;
  byScope: Record<string, number>;
  schemaRejects: number;
}

interface HistoryResponse {
  records: Array<{ id: string; finishedAt: string | null; stage: string; kind: string; title: string; summaryLine?: string }>;
  summary: HistorySummary;
  days: number;
}

/**
 * v0.2c §5.6c: 跨任务累积视角 - 产品页顶部 strip, 显示本周 agent batch 累积。
 * 数据源: ~/.atlas/products/<id>/task-history.jsonl (Atlas 重启后仍在)
 */
export function RecentActivityStrip({ productId, days = 7 }: RecentActivityStripProps) {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/history/${productId}?days=${days}`);
      if (!res.ok) {
        setError(`load failed: ${res.status}`);
        return;
      }
      const json = (await res.json()) as ApiEnvelope<HistoryResponse>;
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [productId, days]);

  useEffect(() => { void load(); }, [load]);
  useDataChange(() => { void load(); });

  if (error) return null; // 默默隐藏, 不打扰
  if (!data || data.summary.count === 0) return null;

  const s = data.summary;
  const scopeParts = Object.entries(s.byScope).map(([scope, n]) => `${n} ${scope}`).join(" · ");
  const stageParts: string[] = [];
  if (s.byStage.completed > 0) stageParts.push(`✓ ${s.byStage.completed}`);
  if (s.byStage.rejected > 0) stageParts.push(`✗ ${s.byStage.rejected}`);
  if (s.byStage.failed > 0) stageParts.push(`✗ ${s.byStage.failed} failed`);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-200 bg-slate-50 px-6 py-1.5 text-[11px] text-slate-600">
      <span className="font-medium text-slate-700">📈 最近 {days} 天 agent 活动</span>
      <span>
        <span className="font-semibold text-slate-900">{s.count}</span> batch ({stageParts.join(" · ") || "in progress"})
      </span>
      {scopeParts ? <span>· {scopeParts}</span> : null}
      {s.schemaRejects > 0 ? (
        <span className="text-amber-700">· schema 拦截 {s.schemaRejects}</span>
      ) : null}
    </div>
  );
}
