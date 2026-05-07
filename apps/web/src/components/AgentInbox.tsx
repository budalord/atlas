import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ClaudeDoc } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface AgentInboxProps {
  claudeDoc: ClaudeDoc | null;
}

export function AgentInbox({ claudeDoc }: AgentInboxProps) {
  const [open, setOpen] = useState(false);
  const hasDoc = !!claudeDoc?.markdown;

  return (
    <section className="border-t border-slate-200 bg-white p-4">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        disabled={!hasDoc}
      >
        <div className="flex items-center gap-2">
          {hasDoc ? (
            open ? (
              <ChevronDown size={14} className="text-slate-500" />
            ) : (
              <ChevronRight size={14} className="text-slate-500" />
            )
          ) : null}
          <h2 className="text-sm font-semibold text-slate-950">CLAUDE.md</h2>
        </div>
        <span className="text-xs text-slate-500">{hasDoc ? "已读取" : "未读取"}</span>
      </button>
      {open && hasDoc && (
        <div className="mt-3 max-h-80 overflow-auto rounded-md border border-slate-200 p-4">
          <MarkdownRenderer markdown={claudeDoc?.markdown ?? ""} />
        </div>
      )}
    </section>
  );
}
