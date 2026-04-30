import { Copy } from "lucide-react";
import { useState } from "react";

interface CopyPromptButtonProps {
  prompt: string;
  label?: string;
  size?: "default" | "sm";
}

export function CopyPromptButton({ prompt, label = "复制指令", size = "default" }: CopyPromptButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  const sizeClass = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm";
  const toneClass = copied
    ? "bg-emerald-600 hover:bg-emerald-600 text-white"
    : "bg-slate-950 hover:bg-slate-800 text-white";

  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md font-medium transition ${sizeClass} ${toneClass}`}
      onClick={copyPrompt}
      type="button"
    >
      <Copy size={size === "sm" ? 12 : 14} />
      {copied ? "已复制" : label}
    </button>
  );
}
