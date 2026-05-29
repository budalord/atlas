import { useState } from "react";
import type { TaskKind } from "../types";

type BatchKind = Exclude<TaskKind, "feature-refine">;

const BATCH_LABELS: Record<BatchKind, string> = {
  "feature-revise": "Run feature revise",
  "usecase-revise": "Run usecase revise",
  "screen-generate": "Run screen generate",
  "screen-revise": "Run screen revise"
};

interface AgentTaskTriggersProps {
  productId: string;
  kinds: ReadonlyArray<BatchKind>;
  className?: string;
}

/**
 * 对象级 batch 触发按钮组,下沉到对应 tab(feature/usecase → 功能与用例,
 * screen → 双轨设计)。只负责 POST /api/tasks 入队 + 报错;入队后 enqueueBatch
 * 会 bumpDataVersion,全局 AgentTasksPanel 经 useDataChange 自动刷新 running/待审。
 */
export function AgentTaskTriggers({ productId, kinds, className }: AgentTaskTriggersProps) {
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const triggerBatch = async (kind: BatchKind) => {
    if (runBusy) return;
    setRunBusy(true);
    setRunError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, kind })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setRunError(body.error ?? `enqueue failed: ${res.status}`);
      }
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <button
            className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50"
            disabled={runBusy}
            key={k}
            onClick={() => triggerBatch(k)}
            type="button"
          >
            {BATCH_LABELS[k]}
          </button>
        ))}
      </div>
      {runError ? <p className="mt-1 text-xs text-rose-600">{runError}</p> : null}
    </div>
  );
}
