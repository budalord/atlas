import { useEffect, useMemo, useState } from "react";
import type { ApiEnvelope, Task, TaskStage } from "../types";
import { useDataChange } from "../lib/useDataChange";
import { useProductStore } from "../stores/productStore";
import { ReviewChangesetModal } from "./ReviewChangesetModal";

/** 任务显示名:所有 kind 都有 title;feature-refine 额外有 featureName。 */
function taskLabel(t: Task): string {
  return t.title || ("featureName" in t ? t.featureName : "") || "(任务)";
}

/** running 任务最新一步(code/product-instruct 的 plan steps 已被 publicView 摊平回 t.steps)。 */
function latestStep(t: Task): string | null {
  return t.steps && t.steps.length > 0 ? t.steps[t.steps.length - 1].label : null;
}

/**
 * 右下角浮动队列指示器。
 * 折叠态:小圆角 chip,显示活动任务计数 + 状态色;
 * 展开态:列出 running / queued / awaiting_review / 最近完成 几段。
 * 点 awaiting_review 行跳转到对应产品(切到 features tab,打开抽屉)。
 */
export function TaskQueueWidget({
  onOpenFeature
}: {
  onOpenFeature: (productId: string, featureId: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [open, setOpen] = useState(false);
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const selectProduct = useProductStore((s) => s.selectProduct);

  const load = async () => {
    try {
      const res = await fetch("/api/tasks");
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<Task[]>;
      setTasks(json.data);
    } catch {
      /* ignore */
    }
  };

  // 点任务:
  // - feature-refine → 打开功能抽屉(它的审核走 .draft 抽屉,不是 changeset 弹窗)。
  // - 其它 kind 且待审 → 直接开审核弹窗(changeset 三态闸),含 code-instruct(搭骨架/建造功能点)。
  // - 其余(running/queued)→ 只切到该产品。
  const handleSelect = (t: Task) => {
    selectProduct(t.productId);
    if (t.kind === "feature-refine") {
      onOpenFeature(t.productId, t.featureId);
    } else if (t.stage === "awaiting_review") {
      setReviewTask(t);
    }
  };

  useEffect(() => {
    void load();
  }, []);
  useDataChange(() => {
    void load();
  });

  // 审核弹窗里的 task 随队列刷新同步;approve/reject 后该 task 离开待审 → 关弹窗。
  useEffect(() => {
    if (!reviewTask) return;
    const fresh = tasks.find((t) => t.id === reviewTask.id);
    if (!fresh || fresh.stage !== "awaiting_review") setReviewTask(null);
  }, [tasks, reviewTask]);

  const buckets = useMemo(() => {
    const running = tasks.filter((t) => t.stage === "running");
    const queued = tasks.filter((t) => t.stage === "queued");
    const review = tasks.filter((t) => t.stage === "awaiting_review");
    const recent = tasks
      .filter((t) => t.stage === "completed" || t.stage === "rejected" || t.stage === "failed")
      .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))
      .slice(0, 5);
    return { running, queued, review, recent };
  }, [tasks]);

  const activeCount = buckets.running.length + buckets.queued.length + buckets.review.length;
  if (activeCount === 0 && buckets.recent.length === 0 && !reviewTask) return null;

  return (
    <>
    {reviewTask ? <ReviewChangesetModal onClose={() => setReviewTask(null)} task={reviewTask} /> : null}
    <div className="fixed bottom-4 right-4 z-30">
      {open ? (
        <div className="w-[320px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              🤖 任务队列
              {activeCount > 0 ? (
                <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                  {activeCount}
                </span>
              ) : null}
            </div>
            <button
              className="text-slate-500 hover:text-slate-900"
              onClick={() => setOpen(false)}
              type="button"
            >
              ✕
            </button>
          </header>
          <div className="max-h-[420px] overflow-auto p-2 text-xs">
            {buckets.running.length === 0 &&
            buckets.queued.length === 0 &&
            buckets.review.length === 0 ? (
              <div className="py-2 text-center text-slate-500">暂无活动任务</div>
            ) : null}
            <Bucket color="amber" label="running" onSelect={handleSelect} showSteps tasks={buckets.running} />
            <Bucket color="slate" label="queued" onSelect={handleSelect} tasks={buckets.queued} />
            <Bucket color="indigo" label="awaiting_review" onSelect={handleSelect} tasks={buckets.review} />
            {buckets.recent.length > 0 ? (
              <>
                <div className="mt-3 mb-1 text-[10px] font-semibold uppercase text-slate-500">
                  最近完成
                </div>
                <ul className="space-y-1">
                  {buckets.recent.map((t) => (
                    <li
                      className="rounded border border-slate-200 bg-white px-2 py-1.5"
                      key={t.id}
                    >
                      <div className="flex items-center justify-between">
                        <span className="truncate text-slate-900">{taskLabel(t)}</span>
                        <StageDot stage={t.stage} />
                      </div>
                      <div className="text-[10px] text-slate-500">{t.productId}</div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          className={`flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm shadow-lg transition hover:shadow-xl ${
            buckets.review.length > 0
              ? "border-indigo-300 text-indigo-800"
              : buckets.running.length > 0
              ? "border-amber-300 text-amber-800"
              : "border-slate-300 text-slate-700"
          }`}
          onClick={() => setOpen(true)}
          type="button"
        >
          <span>🤖</span>
          {buckets.running.length > 0 ? <Spinner /> : null}
          <span className="font-medium">
            {buckets.review.length > 0
              ? `${buckets.review.length} 待审`
              : buckets.running.length > 0
              ? "running"
              : buckets.queued.length > 0
              ? `${buckets.queued.length} 排队`
              : `${buckets.recent.length} 完成`}
          </span>
        </button>
      )}
    </div>
    </>
  );
}

function Bucket({
  label,
  tasks,
  color,
  onSelect,
  showSteps = false
}: {
  label: string;
  tasks: Task[];
  color: "amber" | "slate" | "indigo";
  onSelect: (t: Task) => void;
  /** running 桶:在标题下加一行 agent 当前最新步骤 + 步数。 */
  showSteps?: boolean;
}) {
  if (tasks.length === 0) return null;
  const colorMap = {
    amber: "border-amber-200 bg-amber-50/60 text-amber-900",
    slate: "border-slate-200 bg-slate-50 text-slate-800",
    indigo: "border-indigo-300 bg-indigo-50/70 text-indigo-900"
  } as const;
  return (
    <div className="mb-2">
      <div className="mb-1 text-[10px] font-semibold uppercase text-slate-500">{label}</div>
      <ul className="space-y-1">
        {tasks.map((t) => {
          const step = showSteps ? latestStep(t) : null;
          return (
            <li key={t.id}>
              <button
                className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left transition hover:opacity-80 ${colorMap[color]}`}
                onClick={() => onSelect(t)}
                type="button"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{taskLabel(t)}</div>
                  <div className="text-[10px] opacity-75">{t.productId}</div>
                  {step ? (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-slate-500">
                      ⏳ {step}
                      {t.steps && t.steps.length > 0 ? <span className="opacity-60"> · {t.steps.length} 步</span> : null}
                    </div>
                  ) : null}
                </div>
                <StageDot stage={t.stage} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StageDot({ stage }: { stage: TaskStage }) {
  const map: Record<TaskStage, { color: string; label: string }> = {
    queued: { color: "bg-slate-400", label: "排队" },
    running: { color: "bg-amber-500 animate-pulse", label: "running" },
    awaiting_review: { color: "bg-indigo-500", label: "待审" },
    completed: { color: "bg-emerald-500", label: "完成" },
    rejected: { color: "bg-rose-400", label: "拒绝" },
    failed: { color: "bg-rose-600", label: "失败" }
  };
  const cfg = map[stage];
  return (
    <span className="flex items-center gap-1 text-[10px]">
      <span className={`h-2 w-2 rounded-full ${cfg.color}`} />
      {cfg.label}
    </span>
  );
}

function Spinner() {
  return (
    <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
  );
}
