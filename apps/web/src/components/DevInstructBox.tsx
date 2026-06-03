import { useState } from "react";

interface DevInstructBoxProps {
  productId: string;
}

/**
 * 开发中阶段「需求框」:决策者输入一句话需求 → POST /api/tasks {kind:"product-instruct"}
 * 创建一个 Session(规划器拆 Task → 各 Task 走现有三态闸)。提交后由 SessionTreePanel 显示编排树。
 * 取代旧的「复制提示词去开发」。
 */
export function DevInstructBox({ productId }: DevInstructBoxProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 目标层:规格 md(默认)或真码仓应用代码
  const [target, setTarget] = useState<"spec" | "code">("spec");

  const submit = async () => {
    const text = instruction.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    try {
      const kind = target === "code" ? "code-instruct" : "product-instruct";
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, kind, instruction: text })
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `提交失败: ${res.status}`);
        return;
      }
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">🛠 开发中 · 提需求</h2>
        <span className="text-[11px] text-slate-500">
          {target === "code"
            ? "一句话需求 → agent 直接改真码仓代码(git diff 进待审)"
            : "一句话需求 → agent 规划并直接改规格(改完进待审)"}
        </span>
      </div>
      <div className="mb-2 inline-flex overflow-hidden rounded-md border border-slate-300 text-[11px]">
        {(["spec", "code"] as const).map((t) => (
          <button
            className={`px-2.5 py-1 font-medium transition ${
              target === t ? "bg-slate-950 text-white" : "bg-white text-slate-600 hover:bg-slate-100"
            }`}
            disabled={busy}
            key={t}
            onClick={() => setTarget(t)}
            type="button"
          >
            {t === "spec" ? "改规格" : "改代码"}
          </button>
        ))}
      </div>
      <textarea
        className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400"
        disabled={busy}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
        }}
        placeholder="例如:订单创建页加一个「批量导入学员」入口,并同步更新对应界面规格与 STATUS。（⌘/Ctrl+Enter 提交）"
        rows={3}
        value={instruction}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        {error ? <p className="text-xs text-rose-600">{error}</p> : <span />}
        <button
          className="rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={busy || !instruction.trim()}
          onClick={() => void submit()}
          type="button"
        >
          {busy ? "提交中…" : "提交需求"}
        </button>
      </div>
    </section>
  );
}
