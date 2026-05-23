import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { CopyPromptButton } from "./CopyPromptButton";
import { MarkdownRenderer } from "./MarkdownRenderer";

export type StageState = "done" | "active" | "locked";

interface IntakeStageCardProps {
  index: 1 | 2 | 3;
  title: string;
  description: string;
  state: StageState;
  prompt: string;
  outputName?: string;
  outputMarkdown?: string | null;
  hint?: string;
}

const badgeFor: Record<StageState, { label: string; tone: string }> = {
  done: { label: "完成", tone: "border-emerald-300 bg-emerald-50 text-emerald-800" },
  active: { label: "⏳ 进行中", tone: "border-cyan-300 bg-cyan-50 text-cyan-800" },
  locked: { label: "⬜ 待执行", tone: "border-slate-300 bg-slate-50 text-slate-600" }
};

export function IntakeStageCard({
  index,
  title,
  description,
  state,
  prompt,
  outputName,
  outputMarkdown,
  hint
}: IntakeStageCardProps) {
  const [open, setOpen] = useState(state === "active");
  const badge = badgeFor[state];
  const showOutput = state === "done" && outputMarkdown != null;

  return (
    <section className="rounded-md border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">阶段 {index}</span>
            <h3 className="text-base font-semibold text-slate-950">{title}</h3>
            <span className={`rounded border px-2 py-0.5 text-xs ${badge.tone}`}>{badge.label}</span>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{description}</p>
          {hint ? <p className="mt-1 text-xs text-amber-700">{hint}</p> : null}
        </div>
        <CopyPromptButton label="复制指令" prompt={prompt} />
      </div>

      {showOutput ? (
        <div className="mt-4 border-t border-slate-200 pt-3">
          <button
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
            onClick={() => setOpen((v) => !v)}
            type="button"
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {outputName ?? "产物"}
          </button>
          {open ? (
            <div className="mt-3 max-h-96 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4">
              <MarkdownRenderer markdown={outputMarkdown!} />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
