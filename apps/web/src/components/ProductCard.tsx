import type { Product } from "../types";

interface ProductCardProps {
  product: Product;
  active: boolean;
  onSelect: (id: string) => void;
}

const statusTone: Record<string, string> = {
  "in-progress": "border-cyan-500 bg-cyan-50 text-cyan-800",
  paused: "border-amber-500 bg-amber-50 text-amber-800",
  live: "border-emerald-500 bg-emerald-50 text-emerald-800",
  archived: "border-slate-400 bg-slate-100 text-slate-700"
};

export function ProductCard({ product, active, onSelect }: ProductCardProps) {
  const todoCount = product.todos.filter((todo) => !todo.done).length;

  return (
    <button
      className={`w-full rounded-md border p-4 text-left transition ${
        active ? "border-slate-950 bg-white shadow-sm" : "border-slate-200 bg-slate-50 hover:border-slate-400"
      }`}
      onClick={() => onSelect(product.id)}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">{product.meta.name}</div>
          <div className="mt-1 text-xs text-slate-500">{product.id}</div>
        </div>
        <span className={`shrink-0 rounded border px-2 py-1 text-[11px] ${statusTone[product.meta.status]}`}>
          {product.meta.status}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-5 text-slate-600">{product.summary}</p>
      <div className="mt-4 flex items-center gap-3 text-xs text-slate-500">
        <span>{product.features.length} 功能点</span>
        <span>{todoCount} 待办</span>
        <span>{product.meta.theme}</span>
      </div>
    </button>
  );
}
