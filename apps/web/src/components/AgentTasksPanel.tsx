import { useEffect, useMemo, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import { useUiStore } from "../stores/uiStore";
import type { ApiEnvelope, Task, TaskStage } from "../types";
import { ReviewChangesetModal } from "./ReviewChangesetModal";

interface AgentTasksPanelProps {
  productId: string;
}

/**
 * 产品内嵌的 agent 任务态全局条:展示该产品的「当前任务」(running 实时 step +
 * 待审 Modal 入口)+「最近完成 5 条」。常驻 tab 栏之上,跨 tab 可见,避免漏审。
 * 触发按钮已下沉到对应 tab(见 AgentTaskTriggers);无任何任务时整块隐藏。
 * batch task 点击进 ReviewChangesetModal,feature-refine task 点击仍走 FeatureDrawer。
 */
export function AgentTasksPanel({ productId }: AgentTasksPanelProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const requestFeatureOpen = useUiStore((s) => s.requestFeatureOpen);

  const load = async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<Task[]>;
      setTasks(json.data.filter((t) => t.productId === productId));
    } catch {
      /* ignore */
    }
  };

  const handleTaskClick = (t: Task) => {
    if (t.kind === "feature-refine") {
      requestFeatureOpen(t.productId, t.featureId);
    } else {
      setReviewTask(t);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  useDataChange(() => {
    void load();
  });

  // 同步当前打开 modal 的 task 最新状态
  useEffect(() => {
    if (!reviewTask) return;
    const fresh = tasks.find((t) => t.id === reviewTask.id);
    if (fresh && fresh !== reviewTask) setReviewTask(fresh);
    if (!fresh) setReviewTask(null);
  }, [tasks, reviewTask]);

  const buckets = useMemo(() => {
    const active = tasks.filter(
      (t) => t.stage === "queued" || t.stage === "running" || t.stage === "awaiting_review"
    );
    const recent = tasks
      .filter((t) => t.stage === "completed" || t.stage === "rejected" || t.stage === "failed")
      .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))
      .slice(0, 5);
    return { active, recent };
  }, [tasks]);

  if (buckets.active.length === 0 && buckets.recent.length === 0) return null;

  return (
    <section className="space-y-3 border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-950">🤖 Agent 任务</h2>
        <span className="text-[11px] text-slate-500">
          {buckets.active.length > 0 ? `${buckets.active.length} 个进行中` : "无进行中"}
          {buckets.recent.length > 0 ? ` · ${buckets.recent.length} 个最近完成` : ""}
        </span>
      </div>

      {buckets.active.length > 0 ? (
        <ul className="space-y-2">
          {buckets.active.map((t) => (
            <li key={t.id}>
              <button
                className="block w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-left transition hover:border-slate-400"
                onClick={() => handleTaskClick(t)}
                title={
                  t.stage === "awaiting_review"
                    ? "点击查看 changeset 并接受/拒绝"
                    : "点击查看实时进度"
                }
                type="button"
              >
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{t.title}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {t.kind}
                      {t.kind === "feature-refine" ? ` · ${t.featureId}` : null}
                      {t.summaryLine ? ` · ${t.summaryLine}` : t.changedFiles ? ` · ${t.changedFiles.length} 文件` : null}
                    </div>
                  </div>
                  <StageChip stage={t.stage} />
                </div>
                <StageProgressBar task={t} />
                {t.stage === "running" && t.steps && t.steps.length > 0 ? (
                  <div className="mt-1.5 truncate text-[11px] text-slate-500">
                    <span className="text-amber-600">●</span>{" "}
                    <span className="font-mono">{t.steps[t.steps.length - 1].label}</span>
                  </div>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {buckets.recent.length > 0 ? (
        <div>
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">最近完成</div>
          <ul className="space-y-1">
            {buckets.recent.map((t) => (
              <li key={t.id}>
                <button
                  className="flex w-full items-center justify-between gap-2 rounded border border-transparent px-3 py-1.5 text-left text-xs transition hover:border-slate-200 hover:bg-slate-50"
                  onClick={() => handleTaskClick(t)}
                  type="button"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-slate-900">{t.title}</span>
                    <span className="ml-2 text-[11px] text-slate-400">
                      {t.kind} · {formatDuration(t)}
                      {t.summaryLine ? ` · ${t.summaryLine}` : ""}
                    </span>
                  </div>
                  <StageChip stage={t.stage} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviewTask ? (
        <ReviewChangesetModal onClose={() => setReviewTask(null)} task={reviewTask} />
      ) : null}
    </section>
  );
}

/**
 * 横向阶段条:queued → running → awaiting_review → completed/rejected/failed。
 * 当前阶段高亮,已通过的阶段标实色,未到的阶段虚色;awaiting_review 含暗示用户审阅的箭头。
 */
function StageProgressBar({ task }: { task: Task }) {
  const isTerminalCompleted = task.stage === "completed";
  const isTerminalRejected = task.stage === "rejected" || task.stage === "failed";
  const order: TaskStage[] = ["queued", "running", "awaiting_review"];
  const currentIdx = order.indexOf(task.stage);
  const reachedIdx = isTerminalCompleted || isTerminalRejected ? order.length : currentIdx;

  return (
    <div className="flex items-center gap-1 text-[10px]">
      {order.map((s, i) => {
        const reached = i <= reachedIdx;
        const isCurrent = task.stage === s;
        const baseLabel = s === "awaiting_review" ? "待审" : s === "running" ? "running" : "排队";
        return (
          <div className="flex items-center gap-1" key={s}>
            <span
              className={
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-medium transition " +
                (isCurrent
                  ? "bg-indigo-600 text-white"
                  : reached
                  ? "bg-slate-700 text-slate-100"
                  : "border border-dashed border-slate-300 text-slate-400")
              }
            >
              {baseLabel}
              {isCurrent ? <span className="ml-0.5 animate-pulse">●</span> : null}
            </span>
            {i < order.length - 1 ? (
              <span className={reached && i < reachedIdx ? "text-slate-700" : "text-slate-300"}>›</span>
            ) : null}
          </div>
        );
      })}
      {/* 终态指示 */}
      {isTerminalCompleted ? (
        <>
          <span className="text-slate-300">›</span>
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">✓ 完成</span>
        </>
      ) : null}
      {isTerminalRejected ? (
        <>
          <span className="text-slate-300">›</span>
          <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">
            {task.stage === "failed" ? "✗ 失败" : "✗ 拒绝"}
          </span>
        </>
      ) : null}
    </div>
  );
}

function StageChip({ stage }: { stage: TaskStage }) {
  const cfg: Record<TaskStage, { cls: string; label: string }> = {
    queued: { cls: "bg-slate-100 text-slate-700", label: "排队" },
    running: { cls: "bg-amber-100 text-amber-800", label: "running" },
    awaiting_review: { cls: "bg-indigo-100 text-indigo-800", label: "待审" },
    completed: { cls: "bg-emerald-100 text-emerald-800", label: "完成" },
    rejected: { cls: "bg-rose-100 text-rose-700", label: "拒绝" },
    failed: { cls: "bg-rose-200 text-rose-900", label: "失败" }
  };
  const c = cfg[stage];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${c.cls}`}>{c.label}</span>;
}

function formatDuration(t: Task): string {
  if (!t.startedAt || !t.finishedAt) return "";
  const start = Date.parse(t.startedAt);
  const end = Date.parse(t.finishedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return "";
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return rem === 0 ? `${mins}m` : `${mins}m${rem}s`;
}
