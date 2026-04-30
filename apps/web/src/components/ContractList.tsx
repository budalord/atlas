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
  const activeContract = contracts.find((contract) => contract.id === activeContractId) ?? contracts[0] ?? null;

  return (
    <section className="border-t border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">契约</h2>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{contracts.length}</span>
      </div>

      <div className="space-y-2">
        {contracts.map((contract) => (
          <button
            className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
              activeContract?.id === contract.id
                ? "border-slate-950 bg-slate-50 text-slate-950"
                : "border-slate-200 text-slate-700 hover:border-slate-400"
            }`}
            key={contract.id}
            onClick={() => setActiveContractId(contract.id)}
            type="button"
          >
            <div className="font-medium">{contract.title}</div>
            <div className="mt-1 text-xs text-slate-500">
              {contract.meta.provider} {"->"} {contract.meta.consumers.join(", ")}
            </div>
          </button>
        ))}
      </div>

      {activeContract ? (
        <div className="mt-4 max-h-96 overflow-auto rounded-md border border-slate-200 p-4">
          <MarkdownRenderer markdown={stripLeadingH1(activeContract.markdown)} />
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">暂无契约</div>
      )}
    </section>
  );
}
