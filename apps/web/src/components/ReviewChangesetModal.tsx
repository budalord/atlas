import { useCallback, useEffect, useState } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import type { ApiEnvelope, ChangedFile, Task } from "../types";
import { useDataChange } from "../lib/useDataChange";

interface ReviewChangesetModalProps {
  task: Task;
  onClose: () => void;
}

/**
 * v0.2b1: batch kind (feature-revise / usecase-revise / screen-generate /
 * screen-revise) 跑完后的 changeset review 弹窗。
 * - 列出所有 ChangedFile, 点击展开 ReactDiffViewer 看 before/after
 * - 单文件级 accept / reject (调 /changeset/:idx/accept|reject)
 * - 全局 「Accept all」 / 「Reject all」 调 task 级 approve / reject
 */
export function ReviewChangesetModal({ task, onClose }: ReviewChangesetModalProps) {
  const [files, setFiles] = useState<ChangedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}/changeset`);
      if (!res.ok) {
        setError(`load failed: ${res.status}`);
        return;
      }
      const json = (await res.json()) as ApiEnvelope<ChangedFile[]>;
      setFiles(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [task.id]);

  useEffect(() => { void load(); }, [load]);
  useDataChange(() => { void load(); });

  const taskActive = task.stage === "awaiting_review";

  const handleSingle = async (idx: number, action: "accept" | "reject") => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/changeset/${idx}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `${action} failed`);
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleAll = async (action: "approve" | "reject") => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `${action} failed`);
        return;
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const acceptedCount = files.filter((f) => f.reviewState === "accepted").length;
  const rejectedCount = files.filter((f) => f.reviewState === "rejected").length;
  const pendingCount = files.length - acceptedCount - rejectedCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-baseline justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">{task.title}</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-800">{task.kind}</span>
              <span className="ml-2">{files.length} 个文件变更</span>
              {files.length > 0 ? (
                <span className="ml-2">
                  · {acceptedCount} accepted / {rejectedCount} rejected / {pendingCount} pending
                </span>
              ) : null}
            </p>
          </div>
          <button
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <p className="text-sm text-slate-500">加载中...</p>
          ) : error ? (
            <p className="text-sm text-rose-600">{error}</p>
          ) : files.length === 0 ? (
            <p className="text-sm text-slate-500">此任务没有任何文件变更。</p>
          ) : (
            <ul className="space-y-2">
              {files.map((f, i) => (
                <ChangesetFileRow
                  busy={busy}
                  expanded={expandedIdx === i}
                  file={f}
                  idx={i}
                  key={`${f.path}-${i}`}
                  onAccept={() => handleSingle(i, "accept")}
                  onReject={() => handleSingle(i, "reject")}
                  onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  taskActive={taskActive}
                />
              ))}
            </ul>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3">
          <div className="text-xs text-slate-500">
            {taskActive
              ? "Accept all = 保留 agent 写盘的所有变更; Reject all = 全部回滚到 backup"
              : `任务已 ${task.stage}, 仅查看模式`}
          </div>
          <div className="flex gap-2">
            <button
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              onClick={onClose}
              type="button"
            >
              关闭
            </button>
            {taskActive ? (
              <>
                <button
                  className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => handleAll("reject")}
                  type="button"
                >
                  Reject all
                </button>
                <button
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => handleAll("approve")}
                  type="button"
                >
                  Accept all
                </button>
              </>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}

interface ChangesetFileRowProps {
  busy: boolean;
  expanded: boolean;
  file: ChangedFile;
  idx: number;
  onAccept: () => void;
  onReject: () => void;
  onToggle: () => void;
  taskActive: boolean;
}

function ChangesetFileRow({
  busy,
  expanded,
  file,
  idx,
  onAccept,
  onReject,
  onToggle,
  taskActive
}: ChangesetFileRowProps) {
  const actionCls: Record<ChangedFile["action"], string> = {
    create: "bg-emerald-100 text-emerald-800",
    update: "bg-indigo-100 text-indigo-800",
    delete: "bg-rose-100 text-rose-700"
  };
  const stateCls: Record<NonNullable<ChangedFile["reviewState"]>, string> = {
    pending: "bg-slate-100 text-slate-600",
    accepted: "bg-emerald-50 text-emerald-700",
    rejected: "bg-rose-50 text-rose-700"
  };
  const state = file.reviewState ?? "pending";
  return (
    <li className="rounded-md border border-slate-200">
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <button
          className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
          onClick={onToggle}
          type="button"
        >
          <div className="flex w-full min-w-0 items-center gap-2">
            <span className="text-xs text-slate-400">{expanded ? "▼" : "▶"}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${actionCls[file.action]}`}>
              {file.action}
            </span>
            <span className="truncate font-mono text-xs text-slate-700">{file.path}</span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${stateCls[state]}`}>
              {state}
            </span>
          </div>
          {file.summary ? (
            <div className="ml-6 text-[11px] text-slate-600">{file.summary.line}</div>
          ) : null}
        </button>
        {taskActive && state === "pending" ? (
          <div className="flex shrink-0 gap-1">
            <button
              className="rounded border border-rose-300 px-2 py-0.5 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              disabled={busy}
              onClick={onReject}
              type="button"
            >
              Reject
            </button>
            <button
              className="rounded border border-emerald-300 px-2 py-0.5 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
              disabled={busy}
              onClick={onAccept}
              type="button"
            >
              Accept
            </button>
          </div>
        ) : null}
      </div>
      {expanded ? (
        <div className="border-t border-slate-200 text-xs">
          <ReactDiffViewer
            compareMethod={DiffMethod.LINES}
            leftTitle={file.action === "create" ? "(new file)" : "before"}
            newValue={file.after ?? ""}
            oldValue={file.before ?? ""}
            rightTitle={file.action === "delete" ? "(deleted)" : "after"}
            splitView
            styles={{ contentText: { fontSize: "12px", lineHeight: "18px" } }}
            useDarkTheme={false}
          />
        </div>
      ) : null}
    </li>
  );
}

export default ReviewChangesetModal;
