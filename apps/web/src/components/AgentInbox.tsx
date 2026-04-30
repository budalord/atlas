import type { ClaudeDoc } from "../types";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface AgentInboxProps {
  claudeDoc: ClaudeDoc | null;
}

export function AgentInbox({ claudeDoc }: AgentInboxProps) {
  return (
    <section className="border-t border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">CLAUDE.md</h2>
        <span className="text-xs text-slate-500">{claudeDoc?.updated_at ? "已读取" : "未读取"}</span>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border border-slate-200 p-4">
        <MarkdownRenderer markdown={claudeDoc?.markdown ?? ""} />
      </div>
      {/* TODO: Module 5 inbox placeholder. Add file-backed agent tasks after the CLAUDE.md center is useful. */}
    </section>
  );
}
