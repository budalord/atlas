import { statusChipClass } from "../lib/statusTone";
import type { Product } from "../types";

interface ProductCardProps {
  product: Product;
  active: boolean;
  onSelect: (id: string) => void;
}

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
        <span className={`shrink-0 rounded border px-2 py-1 text-[11px] ${statusChipClass(product.meta.status)}`}>
          {product.meta.status}
        </span>
      </div>
      {product.meta.tagline ? (
        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{product.meta.tagline}</p>
      ) : null}
      <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
        <span>{product.features.length} 功能点</span>
        <span>{todoCount} 待办</span>
        <span>{product.meta.theme}</span>
      </div>
    </button>
  );
}
