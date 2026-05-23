import { useEffect, useMemo, useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import type {
  ApiEnvelope,
  FeatureClue,
  FeaturePoint,
  ModuleColor,
  ModuleSpec,
  RefineTask
} from "../types";
import { useDataChange } from "../lib/useDataChange";
import { CreateIssueDialog } from "./CreateIssueDialog";
import { FeedbackPool } from "./FeedbackPool";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface FeatureDrawerProps {
  productId: string;
  /** 待打开的功能点 id; null 时关闭 */
  featureId: string | null;
  onClose: () => void;
  readOnly?: boolean;
  /** 当前产品 phase,banner 文案用 */
  productPhase?: string;
  /** 点「📄 设计页」时切到 design tab 并定位文件 */
  onOpenDesign?: (name: string) => void;
}

const COLOR_CHIP: Record<ModuleColor, string> = {
  red: "bg-rose-50 text-rose-800 border-rose-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  yellow: "bg-amber-50 text-amber-800 border-amber-200",
  purple: "bg-purple-50 text-purple-800 border-purple-200",
  indigo: "bg-indigo-50 text-indigo-800 border-indigo-200",
  gray: "bg-slate-100 text-slate-700 border-slate-200"
};

interface FeatureBundle {
  feature: FeaturePoint;
  module: ModuleSpec | null;
}

interface DraftBundle {
  original: string;
  draft: string;
}

export function FeatureDrawer({
  productId,
  featureId,
  onClose,
  readOnly = false,
  productPhase,
  onOpenDesign
}: FeatureDrawerProps) {
  const [issueOpen, setIssueOpen] = useState(false);
  const [bundle, setBundle] = useState<FeatureBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [clueInput, setClueInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [tasks, setTasks] = useState<RefineTask[]>([]);
  const [draftBundle, setDraftBundle] = useState<DraftBundle | null>(null);
  const [retryExtra, setRetryExtra] = useState("");
  const [retryOpen, setRetryOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const open = featureId !== null;

  // 与本 feature 相关的最新 task(按 enqueuedAt 倒序取第一个)
  const currentTask = useMemo<RefineTask | null>(() => {
    if (!featureId) return null;
    const filtered = tasks
      .filter((t) => t.productId === productId && t.featureId === featureId)
      .sort((a, b) => b.enqueuedAt.localeCompare(a.enqueuedAt));
    return filtered[0] ?? null;
  }, [tasks, productId, featureId]);

  const load = async () => {
    if (!featureId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${productId}/features/${featureId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      const json = (await res.json()) as ApiEnvelope<FeatureBundle>;
      setBundle(json.data);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  const loadTasks = async () => {
    try {
      const res = await fetch(`/api/tasks`);
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<RefineTask[]>;
      setTasks(json.data);
    } catch {
      /* 队列拉取失败不致命,忽略 */
    }
  };

  const loadDraft = async () => {
    if (!featureId) return;
    try {
      const res = await fetch(`/api/products/${productId}/features/${featureId}/draft`);
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<DraftBundle>;
      setDraftBundle(json.data);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (open) {
      setBundle(null);
      setClueInput("");
      setShowResolved(false);
      setDraftBundle(null);
      setRetryOpen(false);
      setRetryExtra("");
      void load();
      void loadTasks();
      void loadDraft();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, featureId]);

  useDataChange(() => {
    if (open) {
      void load();
      void loadTasks();
      void loadDraft();
    }
  });

  // ESC 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (!clueInput.trim() || !featureId) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/products/${productId}/features/${featureId}/clues`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: clueInput.trim() })
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      setClueInput("");
      const json = (await res.json()) as ApiEnvelope<FeaturePoint>;
      setBundle((b) => (b ? { ...b, feature: json.data } : b));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "添加线索失败");
    } finally {
      setSubmitting(false);
    }
  };

  const refine = async () => {
    if (!featureId) return;
    setActionBusy(true);
    try {
      const res = await fetch(
        `/api/products/${productId}/features/${featureId}/refine`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      await loadTasks();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "入队失败");
    } finally {
      setActionBusy(false);
    }
  };

  const taskAction = async (action: "approve" | "reject" | "retry") => {
    if (!currentTask) return;
    setActionBusy(true);
    try {
      const body: Record<string, unknown> =
        action === "retry" && retryExtra.trim() ? { extra: retryExtra.trim() } : {};
      const res = await fetch(`/api/tasks/${currentTask.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `${res.status}`);
      }
      setRetryOpen(false);
      setRetryExtra("");
      // refetch
      await Promise.all([load(), loadTasks(), loadDraft()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${action} 失败`);
    } finally {
      setActionBusy(false);
    }
  };

  const moduleColor = bundle?.module?.color ?? "gray";
  const chipClass = COLOR_CHIP[moduleColor];

  return (
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      {/* drawer */}
      <aside
        aria-modal
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[640px] flex-col bg-white shadow-xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {bundle?.module ? (
                <span
                  className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${chipClass}`}
                >
                  {bundle.module.title}
                </span>
              ) : null}
              {bundle?.feature?.last_refined_at ? (
                <span className="text-[11px] text-slate-500">
                  上次 refine {bundle.feature.last_refined_at}
                </span>
              ) : null}
            </div>
            <h2 className="mt-1 truncate text-lg font-semibold text-slate-950">
              {bundle?.feature?.name ?? (loading ? "加载中..." : "未找到")}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {bundle?.feature && productPhase !== "planning" ? (
              <button
                aria-label="把这条线索提到 GitHub"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => setIssueOpen(true)}
                title="把这条 feature 提到 GitHub 作为 issue(立项阶段不可用)"
                type="button"
              >
                💬
              </button>
            ) : null}
            {bundle?.feature && onOpenDesign ? (
              <button
                aria-label="查看/创建设计页"
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                onClick={() => onOpenDesign(bundle.feature.id)}
                title="跳到该 feature 的设计页"
                type="button"
              >
                📄
              </button>
            ) : null}
            {!readOnly ? (
              <button
                aria-label="删除功能点"
                className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                disabled={!bundle?.feature}
                onClick={async () => {
                  if (!bundle?.feature) return;
                  const fid = bundle.feature.id;
                  if (!window.confirm(`删除功能点 ${fid}? 该操作不可恢复。`)) return;
                  try {
                    const res = await fetch(`/api/products/${productId}/features/${fid}`, {
                      method: "DELETE"
                    });
                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}));
                      throw new Error(body.error ?? `HTTP ${res.status}`);
                    }
                    onClose();
                  } catch (e) {
                    window.alert(e instanceof Error ? e.message : "删除失败");
                  }
                }}
                title="删除功能点"
                type="button"
              >
                🗑
              </button>
            ) : null}
            <button
              aria-label="关闭"
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              onClick={onClose}
              type="button"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-5">
          {err ? (
            <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {err}
            </div>
          ) : null}
          {bundle?.feature && bundle.feature.added_in_phase && bundle.feature.added_in_phase !== "planning" ? (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              该功能点在【{bundle.feature.added_in_phase === "in-progress" ? "进行中" : "已上线"}】阶段
              {bundle.feature.added_at ? `(${bundle.feature.added_at})` : ""}追加;此前已开发的代码不受影响。
            </div>
          ) : null}
          {bundle?.feature ? (
            <>
              <section className="mb-5">
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  描述
                </h3>
                {bundle.feature.description ? (
                  <div className="rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 text-slate-800">
                    <MarkdownRenderer markdown={bundle.feature.description} />
                  </div>
                ) : (
                  <div className="text-xs text-slate-500">(暂无描述)</div>
                )}
              </section>

              <section className="mb-5">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Pending
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    {bundle.feature.clues.pending.length} 条
                  </span>
                </div>
                {bundle.feature.clues.pending.length === 0 ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700">
                    暂无待处理线索。
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {bundle.feature.clues.pending.map((c, idx) => (
                      <li
                        className="flex flex-wrap items-baseline gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
                        key={`p-${idx}`}
                      >
                        <span className="font-mono text-xs text-amber-700">{c.date}</span>
                        <ClueBadgesDrawer clue={c} />
                        <span className="flex-1">{c.content}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="mb-5">
                <button
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
                  onClick={() => setShowResolved((v) => !v)}
                  type="button"
                >
                  <span>{showResolved ? "▾" : "▸"}</span>
                  <span className="font-semibold uppercase tracking-wide">Resolved</span>
                  <span className="text-[11px]">({bundle.feature.clues.resolved.length})</span>
                </button>
                {showResolved ? (
                  bundle.feature.clues.resolved.length === 0 ? (
                    <div className="mt-2 text-xs text-slate-400">(空)</div>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {bundle.feature.clues.resolved.map((c, idx) => (
                        <li
                          className="flex flex-wrap items-baseline gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                          key={`r-${idx}`}
                        >
                          <span className="font-mono text-xs text-slate-500">{c.date}</span>
                          <ClueBadgesDrawer clue={c} />
                          <span className="flex-1">{c.content}</span>
                        </li>
                      ))}
                    </ul>
                  )
                ) : null}
              </section>

              {/* 批次 2 · 抽屉里的反馈池(数据从 bundle.feature.feedback 直接读,操作通过 props 走 load 重拉) */}
              <section className="mb-5">
                <FeedbackPool
                  feedback={bundle.feature.feedback ?? []}
                  onChanged={load}
                  productId={productId}
                  readOnly={readOnly}
                  target={`feature:${bundle.feature.module}:${bundle.feature.id}`}
                />
              </section>

              {currentTask &&
              currentTask.stage === "awaiting_review" &&
              draftBundle &&
              draftBundle.draft ? (
                <section className="mb-5 rounded-md border border-indigo-300 bg-indigo-50/40">
                  <header className="flex items-center justify-between border-b border-indigo-200 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-medium text-white">
                        草稿待审
                      </span>
                      <span className="text-[11px] text-indigo-800">
                        task {currentTask.id.slice(0, 8)}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {readOnly ? (
                        <span className="text-[11px] text-slate-500">该 phase 下只读 — 无法处理 draft</span>
                      ) : (
                        <>
                          <button
                            className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                            disabled={actionBusy}
                            onClick={() => void taskAction("approve")}
                            title="接受 draft → 覆盖原文件,pending 线索自动转 resolved 并打 [task:tid] 标记"
                            type="button"
                          >
                            接受 draft
                          </button>
                          <button
                            className="rounded bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-60"
                            disabled={actionBusy}
                            onClick={() => void taskAction("reject")}
                            title="丢弃 draft,保留 pending 线索;可后续重新处理"
                            type="button"
                          >
                            ❌ 拒绝 draft
                          </button>
                          <button
                            className="rounded border border-indigo-400 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                            disabled={actionBusy}
                            onClick={() => setRetryOpen((v) => !v)}
                            title="追加补充指令重新处理 — 旧 draft 丢弃,旧任务标 rejected,新任务入队"
                            type="button"
                          >
                            🔄 追加指令重做
                          </button>
                        </>
                      )}
                    </div>
                  </header>
                  {retryOpen ? (
                    <div className="border-b border-indigo-200 bg-white px-3 py-2">
                      <textarea
                        className="w-full resize-none rounded border border-slate-300 px-2 py-1 text-xs leading-5"
                        onChange={(e) => setRetryExtra(e.target.value)}
                        placeholder="补充指令(选填),如:改得简洁些 / 加上家长端的考虑"
                        rows={2}
                        value={retryExtra}
                      />
                      <div className="mt-1.5 flex items-center justify-end gap-2">
                        <button
                          className="text-xs text-slate-500 hover:text-slate-900"
                          onClick={() => {
                            setRetryOpen(false);
                            setRetryExtra("");
                          }}
                          type="button"
                        >
                          取消
                        </button>
                        <button
                          className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white disabled:opacity-60"
                          disabled={actionBusy}
                          onClick={() => void taskAction("retry")}
                          type="button"
                        >
                          确认重做
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <div className="text-xs">
                    <ReactDiffViewer
                      compareMethod={DiffMethod.LINES}
                      leftTitle="original"
                      newValue={draftBundle.draft}
                      oldValue={draftBundle.original}
                      rightTitle="draft"
                      splitView
                      styles={{
                        contentText: { fontSize: "12px", lineHeight: "18px" }
                      }}
                      useDarkTheme={false}
                    />
                  </div>
                </section>
              ) : null}

              {currentTask &&
              (currentTask.stage === "queued" || currentTask.stage === "running") ? (
                <section className="mb-5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {currentTask.stage === "queued"
                    ? "🤖 任务已入队,等待前面任务跑完..."
                    : "🤖 Codex 正在 refine 此功能点..."}
                </section>
              ) : null}

              {currentTask &&
              currentTask.stage === "failed" &&
              currentTask.error ? (
                <section className="mb-5 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  <div className="font-semibold">refine 失败</div>
                  <div className="mt-1 break-words">{currentTask.error}</div>
                </section>
              ) : null}
            </>
          ) : loading ? (
            <div className="text-xs text-slate-500">加载中...</div>
          ) : null}
        </div>

        {readOnly ? (
          <footer className="border-t border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">
            该 phase 下只读;如需变更,使用顶部「💬 提 issue」按钮(本批接入)向 GitHub 提议。
          </footer>
        ) : (
        <footer className="border-t border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">+ 添加线索</div>
            <button
              className="rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
              disabled={
                actionBusy ||
                !bundle?.feature ||
                bundle.feature.clues.pending.length === 0 ||
                (currentTask?.stage === "queued" ||
                  currentTask?.stage === "running" ||
                  currentTask?.stage === "awaiting_review")
              }
              onClick={() => void refine()}
              type="button"
              title={
                bundle?.feature?.clues.pending.length === 0
                  ? "暂无 pending 线索"
                  : currentTask?.stage === "queued" || currentTask?.stage === "running"
                  ? "当前已有任务在跑"
                  : currentTask?.stage === "awaiting_review"
                  ? "请先处理上方草稿"
                  : "调用 Codex CLI 处理 pending 线索"
              }
            >
              🤖 处理 pending 线索
            </button>
          </div>
          <textarea
            className="mt-2 w-full resize-none rounded border border-slate-300 bg-white px-2 py-1.5 text-sm leading-6"
            disabled={submitting || !bundle?.feature}
            onChange={(e) => setClueInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="写下来,⌘/Ctrl + Enter 直接提交"
            rows={3}
            value={clueInput}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">日期自动填今天</span>
            <button
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
              disabled={submitting || !clueInput.trim() || !bundle?.feature}
              onClick={submit}
              type="button"
            >
              {submitting ? "提交中..." : "+ 添加"}
            </button>
          </div>
        </footer>
        )}
      </aside>
      {bundle?.feature ? (
        <CreateIssueDialog
          defaultBody={buildFeatureIssueBody(bundle.feature, productId, productPhase)}
          defaultLabels="feature"
          defaultTitle={`[${productPhase ?? "feature"}] feature ${bundle.feature.id}:`}
          onClose={() => setIssueOpen(false)}
          open={issueOpen}
          productId={productId}
        />
      ) : null}
    </>
  );
}

/**
 * 线索行的状态徽标:
 *   - [task:tid] → 显示 🤖 + 任务 id 缩写(已被 Codex 任务处理过)
 *   - [issue:url|#N] → 显示 🐛 + 链接(已提到 GitHub)
 */
function ClueBadgesDrawer({ clue }: { clue: FeatureClue }) {
  if (!clue.task_id && !clue.issue_url) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {clue.task_id ? (
        <span
          className="rounded border border-indigo-200 bg-indigo-50 px-1 py-0.5 text-[10px] font-mono text-indigo-700"
          title={`Codex 任务 ${clue.task_id}`}
        >
          🤖 {clue.task_id.slice(0, 6)}
        </span>
      ) : null}
      {clue.issue_url ? (
        clue.issue_url.startsWith("http") ? (
          <a
            className="rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[10px] font-mono text-emerald-700 hover:bg-emerald-100"
            href={clue.issue_url}
            rel="noopener noreferrer"
            target="_blank"
            title={`已提到 GitHub: ${clue.issue_url}`}
          >
            🐛 issue
          </a>
        ) : (
          <span
            className="rounded border border-emerald-200 bg-emerald-50 px-1 py-0.5 text-[10px] font-mono text-emerald-700"
            title={`已提到 GitHub: ${clue.issue_url}`}
          >
            🐛 {clue.issue_url}
          </span>
        )
      ) : null}
    </span>
  );
}

function buildFeatureIssueBody(
  feature: FeaturePoint,
  productId: string,
  phase: string | undefined
): string {
  const source = `data/products/${productId}/modules/${feature.module}/features/${feature.id}.md`;
  const desc = (feature.description ?? "").slice(0, 400).trim();
  const pending = feature.clues.pending.slice(0, 5).map((c) => `- (${c.date}) ${c.content}`).join("\n");
  return [
    `**功能点**: ${feature.name} (\`${feature.id}\`)`,
    `**模块**: ${feature.module}`,
    `**当前阶段**: ${phase ?? "未知"}`,
    `**Atlas 源文件**: \`${source}\``,
    "",
    "## 现状摘要",
    desc || "_(暂无描述)_",
    pending ? "\n## 当前 pending 线索\n" + pending : "",
    "",
    "## 修改诉求",
    "<!-- 请在此填写要修改/新增的内容 -->"
  ].join("\n");
}
