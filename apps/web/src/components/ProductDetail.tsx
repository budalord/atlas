import { productLevelPrompt } from "../lib/promptTemplates";
import type { Product } from "../types";
import { CopyPromptButton } from "./CopyPromptButton";
import { FeatureTable } from "./FeatureTable";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ProductDetailProps {
  product: Product | null;
}

export function ProductDetail({ product }: ProductDetailProps) {
  if (!product) {
    return <main className="p-6 text-sm text-slate-500">暂无产品数据</main>;
  }

  return (
    <main className="min-h-0 overflow-auto bg-slate-50">
      <section className="border-b border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{product.meta.theme}</div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">{product.meta.name}</h1>
            {product.meta.tagline ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{product.meta.tagline}</p>
            ) : null}
          </div>
          <CopyPromptButton prompt={productLevelPrompt(product)} />
        </div>
        <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <MetaItem label="状态" value={product.meta.status} />
          <MetaItem label="更新" value={product.last_updated ?? "未填写"} />
          <MetaItem label="源路径" value={product.meta.source_path} />
          <MetaItem label="部署" value={product.meta.deploy_url ?? "未部署"} />
        </dl>
      </section>

      <section className="space-y-6 p-6">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-950">功能点</h2>
          <FeatureTable features={product.features} productId={product.id} />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-950">STATUS.md</h2>
          <div className="rounded-md border border-slate-200 bg-white p-5">
            <MarkdownRenderer markdown={product.statusMarkdown} skipH2Sections={["功能点"]} />
          </div>
        </div>
      </section>
    </main>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 truncate text-sm text-slate-900" title={value}>
        {value}
      </dd>
    </div>
  );
}
