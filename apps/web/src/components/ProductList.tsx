import { useState } from "react";
import {
  PHASE_DEFAULT_COLLAPSED,
  PHASE_LABELS,
  PHASE_ORDER,
  phaseToneClass,
  statusToPhase,
  type ProductPhase
} from "../lib/productPhase";
import { THEME_LABELS, THEME_ORDER, resolveThemeKey } from "../lib/themes";
import type { Product } from "../types";
import { NewProductModal } from "./NewProductModal";
import { ProductCard } from "./ProductCard";
import { WizardModal } from "./WizardModal";

interface ProductListProps {
  products: Product[];
  selectedProductId: string | null;
  onSelect: (id: string) => void;
}

export function ProductList({ products, selectedProductId, onSelect }: ProductListProps) {
  const [collapsed, setCollapsed] = useState<Record<ProductPhase, boolean>>(
    () => ({ ...PHASE_DEFAULT_COLLAPSED })
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const byPhase = new Map<ProductPhase, Product[]>();
  for (const phase of PHASE_ORDER) byPhase.set(phase, []);
  for (const product of products) {
    const phase = statusToPhase(product.meta.status);
    byPhase.get(phase)!.push(product);
  }

  const groups = PHASE_ORDER.map((phase) => ({
    phase,
    items: byPhase.get(phase)!
  })).filter((group) => group.items.length > 0);

  const togglePhase = (phase: ProductPhase) =>
    setCollapsed((prev) => ({ ...prev, [phase]: !prev[phase] }));

  return (
    <aside className="sticky top-0 z-10 max-h-screen min-h-0 self-start overflow-y-auto border-b border-slate-200 bg-white p-4 lg:border-b-0 lg:border-r">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-950">产品</h2>
        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">{products.length}</span>
      </div>

      <div className="mb-5 flex flex-col gap-2">
        <button
          className="w-full rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-600 transition hover:border-slate-500 hover:text-slate-900"
          onClick={() => setModalOpen(true)}
          type="button"
        >
          + 新建 / 录入产品
        </button>
        <button
          className="w-full rounded bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-800"
          onClick={() => setWizardOpen(true)}
          type="button"
          title="5 层骨架(Actor / Capability / Function / UseCase / Entity)Wizard"
        >
          立项 Wizard · 五层骨架
        </button>
      </div>

      {groups.map((group, index) => {
        const isCollapsed = collapsed[group.phase];
        const themeBuckets = THEME_ORDER.map((themeKey) => ({
          key: themeKey,
          label: THEME_LABELS[themeKey],
          items: group.items.filter((p) => resolveThemeKey(p.meta.theme) === themeKey)
        })).filter((bucket) => bucket.items.length > 0);

        return (
          <section className={index === 0 ? "" : "mt-6"} key={group.phase}>
            <button
              aria-expanded={!isCollapsed}
              className="flex w-full items-center justify-between rounded px-1 py-1 text-left transition hover:bg-slate-50"
              onClick={() => togglePhase(group.phase)}
              type="button"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{isCollapsed ? "▸" : "▾"}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${phaseToneClass(group.phase)}`}
                >
                  {PHASE_LABELS[group.phase]}
                </span>
              </div>
              <span className="text-xs text-slate-400">{group.items.length}</span>
            </button>

            {!isCollapsed && (
              <div className="mt-2 space-y-4">
                {themeBuckets.map((bucket) => (
                  <div key={bucket.key}>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        {bucket.label}
                      </h4>
                      <span className="text-[11px] text-slate-400">{bucket.items.length}</span>
                    </div>
                    <div className="space-y-2">
                      {bucket.items.map((product) => (
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
              </div>
            )}
          </section>
        );
      })}

      <NewProductModal
        onClose={() => setModalOpen(false)}
        onCreated={onSelect}
        open={modalOpen}
      />
      {wizardOpen ? (
        <WizardModal
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => {
            setWizardOpen(false);
            onSelect(id);
          }}
        />
      ) : null}
    </aside>
  );
}
