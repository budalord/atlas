import { useCallback, useEffect, useState } from "react";
import type { ApiEnvelope, OverlapGroup, OverlapReport } from "../types";
import { useDataChange } from "../lib/useDataChange";

interface FeatureOverlapBannerProps {
  productId: string;
  readOnly?: boolean;
}

/**
 * Feature 重叠检测横幅 — FeatureTab 顶部, 默认折叠。
 *
 * 数据源: GET /api/products/:id/features/overlap-report
 * 用户操作:
 *   - "让 agent 处理" → POST overlap-act action=to-agent → 写全局需求池 feature 段
 *   - "✕ 忽略 (不是同一件事)" → POST overlap-act action=ignore → 写 sidecar overlap-ignored.yml
 * 决策后 SSE 触发刷新, 该组从列表消失(已落到全局需求池 / 已忽略)
 */
export function FeatureOverlapBanner({ productId, readOnly = false }: FeatureOverlapBannerProps) {
  const [data, setData] = useState<OverlapReport | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/features/overlap-report`);
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<OverlapReport>;
      setData(json.data);
    } catch {
      // 静默
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (!data || data.groups.length === 0) return null;

  return (
    <section className="border-b border-amber-200 bg-amber-50/40">
      <button
        className="flex w-full items-center justify-between px-5 py-2 text-left text-[12px] hover:bg-amber-50/70"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="flex items-center gap-2">
          <svg
            className={`h-3.5 w-3.5 text-amber-700 transition-transform ${open ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="M9 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-medium text-amber-900">
            重叠检测 · 发现 {data.groups.length} 组可能重复的 features
          </span>
          {data.ignored_count > 0 ? (
            <span className="text-[10px] text-slate-500">· 已忽略 {data.ignored_count}</span>
          ) : null}
        </span>
        <span className="text-[10px] text-slate-500">{open ? "收起" : "展开"}</span>
      </button>

      {open ? (
        <ul className="divide-y divide-amber-100 border-t border-amber-100">
          {data.groups.map((g) => (
            <OverlapGroupRow
              key={g.id}
              group={g}
              productId={productId}
              readOnly={readOnly}
              onChanged={() => void load()}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function OverlapGroupRow({
  group,
  productId,
  readOnly,
  onChanged
}: {
  group: OverlapGroup;
  productId: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ignoreOpen, setIgnoreOpen] = useState(false);
  const [ignoreReason, setIgnoreReason] = useState("");

  const act = async (action: "to-agent" | "ignore", reason?: string) => {
    setSubmitting(true);
    setErr(null);
    try {
      const feature_ids = group.features.map((f) => `${f.moduleId}/${f.featureId}`);
      const names = group.features.map((f) => f.name);
      const res = await fetch(`/api/products/${productId}/features/overlap-act`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          feature_ids,
          reasons: group.reasons,
          names,
          reason
        })
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
      setIgnoreOpen(false);
      setIgnoreReason("");
    }
  };

  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-amber-800">
            {group.reasons.join(" · ")}
          </div>
          <ul className="mt-1 space-y-0.5">
            {group.features.map((f) => (
              <li key={`${f.moduleId}/${f.featureId}`} className="text-[12px] text-slate-800">
                <code className="font-mono text-slate-500">{f.moduleId}/{f.featureId}</code>
                <span className="ml-2">{f.name}</span>
              </li>
            ))}
          </ul>

          {ignoreOpen ? (
            <form
              className="mt-2 rounded border border-slate-300 bg-white px-2 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                void act("ignore", ignoreReason);
              }}
            >
              <input
                autoFocus
                className="w-full rounded border border-slate-300 px-2 py-1 text-[11px]"
                onChange={(e) => setIgnoreReason(e.target.value)}
                placeholder="原因(可填:actor 不同 / 状态机不同 / 字段权限本质差异 等)..."
                type="text"
                value={ignoreReason}
              />
              <div className="mt-1 flex justify-end gap-2">
                <button
                  className="rounded px-2 py-0.5 text-[11px] text-slate-600 hover:text-slate-900"
                  onClick={() => {
                    setIgnoreOpen(false);
                    setIgnoreReason("");
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                  disabled={submitting || !ignoreReason.trim()}
                  type="submit"
                >
                  {submitting ? "提交中..." : "确认忽略"}
                </button>
              </div>
            </form>
          ) : null}

          {err ? <div className="mt-1 text-[11px] text-rose-700">{err}</div> : null}
        </div>

        {!readOnly && !ignoreOpen ? (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              className="rounded border border-amber-400 bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-50"
              disabled={submitting}
              onClick={() => void act("to-agent")}
              title="把该组写入全局需求池 (feature 段), 让 agent 下轮 revise 时合并 / 区分"
              type="button"
            >
              让 agent 处理
            </button>
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-500 disabled:opacity-50"
              disabled={submitting}
              onClick={() => setIgnoreOpen(true)}
              title="标这组不是同一件事, 写 sidecar 下次不再提示"
              type="button"
            >
              ✕ 忽略
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
