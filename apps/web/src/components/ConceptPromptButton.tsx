import { Image, Check, AlertCircle } from "lucide-react";
import { useState } from "react";

/**
 * 复制「概念参考图」指令 → 粘贴进 codex 客户端 → codex 生成 3–4 张概念图存到 concepts/。
 * codex 只产参考(mood board), 不上线; 每页生产图由 Atlas 用冻结壳渲染。
 * 点击时才拉取 prompt(避免每次渲染都打 api)。
 */
export function ConceptPromptButton({ productId }: { productId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "copied" | "error">("idle");

  async function run() {
    if (state === "loading") return;
    setState("loading");
    try {
      const res = await fetch(
        `/api/products/${productId}/generate-prompt?scope=concept-reference`
      );
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { data: { prompt: string } };
      await navigator.clipboard.writeText(body.data.prompt);
      setState("copied");
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
      window.setTimeout(() => setState("idle"), 2500);
    }
  }

  const tone =
    state === "copied"
      ? "bg-emerald-600 text-white"
      : state === "error"
        ? "bg-red-600 text-white"
        : "bg-slate-950 hover:bg-slate-800 text-white";
  const Icon = state === "copied" ? Check : state === "error" ? AlertCircle : Image;
  const text =
    state === "copied"
      ? "已复制"
      : state === "error"
        ? "失败"
        : state === "loading"
          ? "生成中…"
          : "复制概念图指令";

  return (
    <button
      type="button"
      onClick={run}
      title="复制给 codex 的概念参考图指令 → 粘贴进 codex 客户端生成参考图(存到 concepts/),Atlas 吸收后自行渲染每页"
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition ${tone}`}
    >
      <Icon size={14} />
      {text}
    </button>
  );
}
