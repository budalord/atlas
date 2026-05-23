import { useEffect, useState } from "react";

interface CreateIssueDialogProps {
  open: boolean;
  productId: string;
  /** 预填 title,如 `[in-progress] feature lead-import:`(用户可改) */
  defaultTitle: string;
  /** 预填 body,通常含来源路径 + 摘要 */
  defaultBody: string;
  defaultLabels?: string;
  onClose: () => void;
}

interface CreatedIssue {
  url: string;
  number: number;
}

export function CreateIssueDialog({
  open,
  productId,
  defaultTitle,
  defaultBody,
  defaultLabels = "",
  onClose
}: CreateIssueDialogProps) {
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState(defaultBody);
  const [labels, setLabels] = useState(defaultLabels);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedIssue | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle(defaultTitle);
    setBody(defaultBody);
    setLabels(defaultLabels);
    setErr(null);
    setCreated(null);
    setBusy(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, defaultTitle, defaultBody, defaultLabels, onClose]);

  if (!open) return null;

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const labelsArr = labels
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch(`/api/products/${productId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body, labels: labelsArr })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = await res.json();
      setCreated(json.data as CreatedIssue);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-950">向 GitHub 提 issue</h2>
          <button
            aria-label="关闭"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>

        {created ? (
          <div className="space-y-3 px-5 py-4 text-sm">
            <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
              已创建 issue #{created.number}
            </div>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                readOnly
                value={created.url}
              />
              <button
                className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-slate-500"
                onClick={() => navigator.clipboard.writeText(created.url).catch(() => undefined)}
                type="button"
              >
                复制
              </button>
              <a
                className="rounded bg-slate-900 px-2 py-1 text-xs text-white hover:bg-slate-800"
                href={created.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                打开
              </a>
            </div>
            <div className="pt-1 text-right">
              <button
                className="rounded px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
                onClick={onClose}
                type="button"
              >
                关闭
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            <label className="block text-xs">
              <div className="mb-1 font-medium text-slate-700">标题</div>
              <input
                autoFocus
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-950 focus:outline-none"
                onChange={(e) => setTitle(e.target.value)}
                value={title}
              />
            </label>
            <label className="block text-xs">
              <div className="mb-1 font-medium text-slate-700">正文(支持 markdown)</div>
              <textarea
                className="h-48 w-full resize-y rounded border border-slate-300 px-2 py-1.5 font-mono text-xs leading-5 focus:border-slate-950 focus:outline-none"
                onChange={(e) => setBody(e.target.value)}
                value={body}
              />
            </label>
            <label className="block text-xs">
              <div className="mb-1 font-medium text-slate-700">标签(逗号分隔,可空)</div>
              <input
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm focus:border-slate-950 focus:outline-none"
                onChange={(e) => setLabels(e.target.value)}
                placeholder="atlas, feature-request"
                value={labels}
              />
            </label>
            {err ? (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {err}
              </div>
            ) : null}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                className="rounded px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900"
                onClick={onClose}
                type="button"
              >
                取消
              </button>
              <button
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-60"
                disabled={busy || !title.trim()}
                onClick={submit}
                type="button"
              >
                {busy ? "提交中..." : "提交"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
