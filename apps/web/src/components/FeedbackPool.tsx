import { useState } from "react";
import type { Feedback } from "../types";

interface FeedbackPoolProps {
  productId: string;
  /**
   * 目标定位字符串,后端通过它解析到具体 md 文件:
   *   "feature:<m>:<f>" → modules/<m>/features/<f>.md
   *   "entity:<e>"      → entities/<e>.md
   *   "entity:<m>:<e>"  → modules/<m>/entities/<e>.md
   */
  target: string;
  /** 当前已解析的反馈数组(父组件从 feature.feedback / entity.feedback 传入) */
  feedback: Feedback[];
  /** 父组件应在每次成功 POST/DELETE 后重新拉取数据(SSE 也会触发,但回调更即时) */
  onChanged?: () => void;
  /** status=live/paused/archived 时为 true:只展示,不允许提交/删除 */
  readOnly?: boolean;
}

function generateClientId(today: string): string {
  const ymd = today.replace(/-/g, "");
  let rand = "";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(4);
    crypto.getRandomValues(buf);
    rand = Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 6);
  } else {
    rand = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
  }
  return `fb-${ymd}-${rand}`;
}

export function FeedbackPool({
  productId,
  target,
  feedback,
  onChanged,
  readOnly = false
}: FeedbackPoolProps) {
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmitNew = async (content: string) => {
    setSubmitting(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const clientId = generateClientId(today);
      const res = await fetch(`/api/products/${productId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target, content, id: clientId })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setCreating(false);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (fbId: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/feedback/${fbId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <section className="rounded-md border border-slate-200 bg-white">
      <header className="flex items-baseline justify-between border-b border-slate-200 px-4 py-2">
        <h3 className="text-sm font-semibold text-slate-900">
          反馈池 <span className="ml-1 text-xs font-normal text-slate-500">({feedback.length})</span>
        </h3>
        {!readOnly && !creating ? (
          <button
            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-slate-500 hover:text-slate-900"
            onClick={() => {
              setCreating(true);
              setError(null);
            }}
            type="button"
          >
            + 加反馈
          </button>
        ) : null}
      </header>

      {creating && !readOnly ? (
        <NewFeedbackForm
          onCancel={() => {
            setCreating(false);
            setError(null);
          }}
          onSubmit={handleSubmitNew}
          submitting={submitting}
        />
      ) : null}

      {error ? (
        <div className="mx-4 mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
          {error}
        </div>
      ) : null}

      {feedback.length === 0 ? (
        <div className="px-4 py-6 text-xs text-slate-500">
          暂无反馈。{!readOnly ? "点上方「+ 加反馈」记一条,Agent 下轮会读这里再 revise。" : ""}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100">
          {feedback.map((fb) => (
            <FeedbackRow
              fb={fb}
              key={fb.id}
              onDelete={() => handleDelete(fb.id)}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function NewFeedbackForm({
  onSubmit,
  onCancel,
  submitting
}: {
  onSubmit: (content: string) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [content, setContent] = useState("");
  const canSubmit = content.trim().length > 0;

  return (
    <form
      className="border-b border-slate-200 bg-slate-50 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSubmit) return;
        onSubmit(content.trim());
      }}
    >
      <textarea
        autoFocus
        className="w-full resize-none rounded border border-slate-300 bg-white px-2 py-1.5 text-sm leading-6"
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            if (canSubmit) onSubmit(content.trim());
          }
        }}
        placeholder="写下来,⌘/Ctrl + Enter 直接提交"
        rows={3}
        value={content}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          className="rounded px-2 py-1 text-xs text-slate-600 hover:text-slate-900"
          onClick={onCancel}
          type="button"
        >
          取消
        </button>
        <button
          className="rounded bg-slate-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
          disabled={submitting || !canSubmit}
          type="submit"
        >
          {submitting ? "提交中..." : "+ 添加"}
        </button>
      </div>
    </form>
  );
}

function FeedbackRow({
  fb,
  onDelete,
  readOnly
}: {
  fb: Feedback;
  onDelete: () => void;
  readOnly: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentLines = fb.content ? fb.content.split("\n") : [];
  const isLong = contentLines.length > 2 || fb.content.length > 120;

  return (
    <li className="px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-slate-500">{fb.date}</span>
          <span className="font-mono text-[10px] text-slate-400" title={fb.id}>
            {fb.id.slice(0, 10)}
          </span>
        </div>
        {!readOnly ? (
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 hover:bg-rose-50 hover:text-rose-700"
            onClick={onDelete}
            title="删除该反馈(若是最后一条,frontmatter 的 needs_revision 会一起抹掉)"
            type="button"
          >
            删除
          </button>
        ) : null}
      </div>

      {fb.content ? (
        <div className={`mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-800 ${
          !expanded && isLong ? "line-clamp-2" : ""
        }`}>
          {fb.content}
        </div>
      ) : (
        <div className="mt-1 text-xs italic text-slate-400">(无正文)</div>
      )}

      {isLong ? (
        <button
          className="mt-0.5 text-[11px] text-slate-500 hover:text-slate-800"
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          {expanded ? "收起" : "展开"}
        </button>
      ) : null}
    </li>
  );
}
