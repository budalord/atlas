import { extractSection, parseKeyValueLines } from "../lib/markdown";
import { productLevelPrompt } from "../lib/promptTemplates";
import { statusChipClass } from "../lib/statusTone";
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

  const summary = extractSection(product.statusMarkdown, "当前状态");
  const blockers = extractSection(product.statusMarkdown, "阻塞");
  const flowchart = extractSection(product.statusMarkdown, "流程图");

  return (
    <main className="min-h-0 overflow-auto bg-slate-50">
      <section className="border-b border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{product.meta.theme}</span>
              <span className={`rounded border px-2 py-0.5 text-[11px] font-medium ${statusChipClass(product.meta.status)}`}>
                {product.meta.status}
              </span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950">{product.meta.name}</h1>
            {product.meta.tagline ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{product.meta.tagline}</p>
            ) : null}
          </div>
          <CopyPromptButton prompt={productLevelPrompt(product)} />
        </div>
        <dl className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-600">
          <MetaInline label="更新" value={product.last_updated ?? "未填写"} />
          <MetaInline label="源路径" value={product.meta.source_path} />
          <MetaInline label="部署" value={product.meta.deploy_url ?? "未部署"} />
        </dl>
      </section>

      <section className="space-y-4 p-6">
        {summary ? (
          <Card title="当前状态">
            <SummaryBody markdown={summary} />
          </Card>
        ) : null}

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-950">功能点</h2>
          <FeatureTable features={product.features} productId={product.id} />
        </div>

        {blockers ? (
          <Card title="阻塞" tone="warning">
            <MarkdownRenderer markdown={blockers} />
          </Card>
        ) : null}

        {flowchart ? (
          <Card title="流程图">
            <MarkdownRenderer markdown={flowchart} />
          </Card>
        ) : null}
      </section>
    </main>
  );
}

function MetaInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="text-slate-500">{label}</span>
      <span className="truncate text-slate-900" title={value}>
        {value}
      </span>
    </div>
  );
}

function SummaryBody({ markdown }: { markdown: string }) {
  const kv = parseKeyValueLines(markdown);
  if (kv) {
    return (
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
        {kv.map((item) => (
          <div className="contents" key={item.label}>
            <dt className="text-sm font-medium text-slate-500">{item.label}</dt>
            <dd className="text-sm leading-6 text-slate-900">{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return <MarkdownRenderer markdown={markdown} />;
}

function Card({ title, tone, children }: { title: string; tone?: "warning"; children: React.ReactNode }) {
  const headerCls =
    tone === "warning" ? "text-amber-800" : "text-slate-950";
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className={`border-b border-slate-200 px-5 py-2 text-sm font-semibold ${headerCls}`}>{title}</div>
      <div className="p-5">{children}</div>
    </div>
  );
}
