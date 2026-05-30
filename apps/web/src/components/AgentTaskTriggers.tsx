import { useState } from "react";
import type { TaskKind } from "../types";

type BatchKind = Exclude<TaskKind, "feature-refine">;

/** 一个按钮 = 一个 label + 一组按顺序入队的 batch kind(单 kind 即 [x],合并即 [a,b])。 */
export interface AgentTrigger {
  label: string;
  kinds: ReadonlyArray<BatchKind>;
  /** 外部门控: true 时按钮置灰不可点(如下游无更新 / 无待处理项) */
  disabled?: boolean;
  /** disabled 时的悬浮提示, 说明为什么点不了 */
  disabledHint?: string;
}

interface AgentTaskTriggersProps {
  productId: string;
  triggers: ReadonlyArray<AgentTrigger>;
  className?: string;
}

/**
 * 对象级 batch 触发按钮组,下沉到对应 tab(功能与用例 / 角色 / 实体 / 双轨设计)。
 * 只负责按顺序 POST /api/tasks 入队 + 报错;入队后 enqueueBatch 会 bumpDataVersion,
 * 全局 AgentTasksPanel 经 useDataChange 自动刷新 running/待审。
 */
export function AgentTaskTriggers({ productId, triggers, className }: AgentTaskTriggersProps) {
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const fire = async (kinds: ReadonlyArray<BatchKind>) => {
    if (runBusy) return;
    setRunBusy(true);
    setRunError(null);
    try {
      for (const kind of kinds) {
        const res = await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId, kind })
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setRunError(body.error ?? `enqueue failed: ${res.status}`);
          return;
        }
      }
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5">
        {triggers.map((t) => (
          <button
            className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={runBusy || t.disabled}
            key={t.label}
            onClick={() => fire(t.kinds)}
            title={t.disabled ? t.disabledHint : undefined}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>
      {runError ? <p className="mt-1 text-xs text-rose-600">{runError}</p> : null}
    </div>
  );
}
