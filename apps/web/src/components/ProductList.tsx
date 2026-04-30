import { THEME_LABELS, THEME_ORDER, resolveThemeKey } from "../lib/themes";
import type { Product } from "../types";
import { ProductCard } from "./ProductCard";

interface ProductListProps {
  products: Product[];
  selectedProductId: string | null;
  onSelect: (id: string) => void;
}

export function ProductList({ products, selectedProductId, onSelect }: ProductListProps) {
  const groups = THEME_ORDER.map((key) => ({
    key,
    label: THEME_LABELS[key],
    items: products.filter((product) => resolveThemeKey(product.meta.theme) === key)
  })).filter((group) => group.items.length > 0);

  return (
    <aside className="min-h-0 overflow-auto border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">产品</h2>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{products.length}</span>
      </div>
      {groups.map((group, index) => (
        <div className={index === 0 ? "" : "mt-8"} key={group.key}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</h3>
            <span className="text-xs text-slate-400">{group.items.length}</span>
          </div>
          <div className="space-y-3">
            {group.items.map((product) => (
              <ProductCard
                active={product.id === selectedProductId}
                key={product.id}
                onSelect={onSelect}
                product={product}
              />
            ))}
          </div>
        </div>
      ))}
    </aside>
  );
}
