import { useCallback, useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import type {
  AgentSessionTree,
  ApiEnvelope,
  InstructTask,
  NodeState,
  TaskPlan,
  TaskStage
} from "../types";
import { ReviewChangesetModal } from "./ReviewChangesetModal";

interface SessionTreePanelProps {
  productId: string;
}

/**
 * 开发中阶段的 Session 编排树:Session(会话) → Task(任务) → Plan(计划) → Step(步骤/ReAct)。
 * 数据来自 GET /api/products/:id/sessions;审核复用现有 ReviewChangesetModal(三态闸,不另起审核态)。
 */
export function SessionTreePanel({ productId }: SessionTreePanelProps) {
  const [trees, setTrees] = useState<AgentSessionTree[]>([]);
  const [reviewTask, setReviewTask] = useState<InstructTask | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/sessions`);
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<AgentSessionTree[]>;
      setTrees(json.data);
    } catch {
      /* ignore */
    }
  }, [productId]);

  useEffect(() => {
    setTrees([]);
    void load();
  }, [load]);
  useDataChange(() => void load());

  // 同步打开中的审核 task 最新态
  useEffect(() => {
    if (!reviewTask) return;
    const fresh = trees.flatMap((t) => t.tasks).find((t) => t.id === reviewTask.id);
    if (fresh && fresh !== reviewTask) setReviewTask(fresh);
    if (!fresh) setReviewTask(null);
  }, [trees, reviewTask]);

  if (trees.length === 0) return null;

  return (
    <section className="border-b border-slate-200 bg-white px-6 py-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-950">🌳 需求编排树</h2>
      <div className="space-y-3">
        {trees.map((tree) => (
          <SessionCard key={tree.session.id} onReview={setReviewTask} tree={tree} />
        ))}
      </div>
      {reviewTask ? (
        <ReviewChangesetModal onClose={() => setReviewTask(null)} task={reviewTask} />
      ) : null}
    </section>
  );
}

function SessionCard({
  tree,
  onReview
}: {
  tree: AgentSessionTree;
  onReview: (t: InstructTask) => void;
}) {
  const { session, tasks } = tree;
  const planning = session.taskIds.length === 0 && session.state === "running";
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs">🗨</span>
            <span className="truncate text-sm font-medium text-slate-900" title={session.instruction}>
              {session.instruction}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-400">sess · {session.createdAt.slice(0, 19).replace("T", " ")}</div>
        </div>
        <NodeBadge state={session.state} />
      </div>

      {session.planError ? (
        <p className="mt-1 text-[11px] text-amber-700">规划告警:{session.planError}(已兜底)</p>
      ) : null}
      {planning ? <p className="mt-2 text-[12px] text-slate-500">规划中…(agent 正在把需求拆成 Task)</p> : null}

      {tasks.length > 0 ? (
        <ul className="mt-2 space-y-2">
          {tasks.map((task, i) => (
            <TaskNode index={i + 1} key={task.id} onReview={onReview} task={task} />
          ))}
        </ul>
      ) : null}

      {session.state === "finished" ? (
        <div className="mt-2 inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
          🏁 Tree Completed
        </div>
      ) : null}
    </div>
  );
}

function TaskNode({
  task,
  index,
  onReview
}: {
  task: InstructTask;
  index: number;
  onReview: (t: InstructTask) => void;
}) {
  const plans = task.plans ?? [];
  return (
    <li className="rounded-md border border-slate-200 bg-white p-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <span className="mr-1 font-mono text-[10px] text-slate-400">Task {index}</span>
          <span className="text-[13px] font-medium text-slate-900">{task.title}</span>
          {task.summaryLine ? (
            <span className="ml-1 text-[11px] text-slate-500">· {task.summaryLine}</span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {task.stage === "awaiting_review" ? (
            <button
              className="rounded bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-700"
              onClick={() => onReview(task)}
              type="button"
            >
              审核
            </button>
          ) : null}
          <StageChip stage={task.stage} />
        </div>
      </div>
      {task.error ? <p className="mt-1 text-[11px] text-rose-600">{task.error}</p> : null}

      {plans.map((plan) => (
        <PlanNode key={plan.id} plan={plan} />
      ))}
    </li>
  );
}

function PlanNode({ plan }: { plan: TaskPlan }) {
  const steps = plan.steps ?? [];
  return (
    <div className="mt-2 border-l-2 border-slate-200 pl-3">
      <div className="flex items-center gap-2">
        <NodeDot state={plan.state} />
        <span className="font-mono text-[11px] text-slate-600">Plan · {plan.kind}</span>
        <span className="text-[10px] text-slate-400">
          {steps.length > 0 ? `${steps.length} 步` : ""}
          {plan.changedFiles && plan.changedFiles.length > 0 ? ` · ${plan.changedFiles.length} 文件` : ""}
        </span>
      </div>
      {steps.length > 0 ? (
        <ol className="mt-1 space-y-0.5">
          {steps.slice(-8).map((s, i) => (
            <li className="flex items-baseline gap-2 text-[11px]" key={i}>
              <span className="font-mono text-[9px] text-slate-400">{i + 1}</span>
              <span className="truncate font-mono text-slate-600">{s.label}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const NODE_TONE: Record<NodeState, string> = {
  pending: "bg-slate-200 text-slate-600",
  running: "bg-sky-100 text-sky-700",
  finished: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-700"
};
const NODE_LABEL: Record<NodeState, string> = {
  pending: "pending",
  running: "running",
  finished: "finished",
  failed: "failed"
};

function NodeBadge({ state }: { state: NodeState }) {
  return (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${NODE_TONE[state]}`}>
      {NODE_LABEL[state]}
    </span>
  );
}

const NODE_DOT: Record<NodeState, string> = {
  pending: "bg-slate-300",
  running: "bg-sky-500 animate-pulse",
  finished: "bg-emerald-500",
  failed: "bg-rose-500"
};
function NodeDot({ state }: { state: NodeState }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${NODE_DOT[state]}`} />;
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
