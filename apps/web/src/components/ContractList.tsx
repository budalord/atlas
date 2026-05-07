import { ChevronDown, ChevronRight } from "lucide-react";
import { stripLeadingH1 } from "../lib/markdown";
import type { Contract } from "../types";
import { useUiStore } from "../stores/uiStore";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ContractListProps {
  contracts: Contract[];
}

export function ContractList({ contracts }: ContractListProps) {
  const activeContractId = useUiStore((state) => state.activeContractId);
  const setActiveContractId = useUiStore((state) => state.setActiveContractId);

  function toggle(id: string) {
    setActiveContractId(activeContractId === id ? null : id);
  }

  return (
    <section className="border-t border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">契约</h2>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{contracts.length}</span>
      </div>

      {contracts.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无契约</div>
      ) : (
        <div className="space-y-2">
          {contracts.map((contract) => {
            const isOpen = activeContractId === contract.id;
            return (
              <div
                key={contract.id}
                className={`overflow-hidden rounded-md border ${
                  isOpen ? "border-slate-950" : "border-slate-200"
                }`}
              >
                <button
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => toggle(contract.id)}
                  type="button"
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown size={14} className="mt-0.5 shrink-0 text-slate-500" />
                  ) : (
                    <ChevronRight size={14} className="mt-0.5 shrink-0 text-slate-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-slate-900">{contract.title}</div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {contract.meta.provider} {"->"} {contract.meta.consumers.join(", ")}
                    </div>
                  </div>
                </button>
                {isOpen && (
                  <div className="max-h-96 overflow-auto border-t border-slate-200 bg-slate-50/50 p-4 text-sm">
                    <MarkdownRenderer markdown={stripLeadingH1(contract.markdown)} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
