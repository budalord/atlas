import { useCallback, useEffect, useMemo, useState } from "react";
import { extractSection, parseKeyValueLines } from "../lib/markdown";
import { TAB_LABELS, tabsForPhase, type TabKey } from "../lib/phaseTabs";
import { statusToPhase } from "../lib/productPhase";
import { productLevelPrompt } from "../lib/promptTemplates";
import { useDataChange } from "../lib/useDataChange";
import type { ApiEnvelope, ModuleWithFeatures, Product, ProductVision } from "../types";
import { AdditionalDocsPanel } from "./AdditionalDocsPanel";
import { AgentTasksPanel } from "./AgentTasksPanel";
import { CommitList } from "./CommitList";
import { CopyPromptButton } from "./CopyPromptButton";
import { FeatureTable } from "./FeatureTable";
import { GitHubPanel } from "./GitHubPanel";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ProductStatusBar } from "./ProductStatusBar";
import { ReviewDashboard } from "./ReviewDashboard";
import { TodoBoard } from "./TodoBoard";
import { ActorTab } from "./tabs/ActorTab";
import { ConventionsTab } from "./tabs/ConventionsTab";
import { DesignTab } from "./tabs/DesignTab";
import { EntityTab } from "./tabs/EntityTab";
import { FeatureTab } from "./tabs/FeatureTab";
import { MatrixTab } from "./tabs/MatrixTab";
import { SpecTab } from "./tabs/SpecTab";
import { FeatureDrawer } from "./FeatureDrawer";
import { useUiStore } from "../stores/uiStore";

interface ProductDetailProps {
  product: Product | null;
}

export function ProductDetail({ product }: ProductDetailProps) {
  const [tab, setTab] = useState<TabKey>("features");
  const [openFeatureId, setOpenFeatureId] = useState<string | null>(null);
  const [openDesignName, setOpenDesignName] = useState<string | null>(null);
  const consumeFeatureOpen = useUiStore((s) => s.consumeFeatureOpen);
  const pendingFeatureOpen = useUiStore((s) => s.pendingFeatureOpen);

  // 来自 TaskQueueWidget 的"打开抽屉"请求(productId 匹配本组件时消费)
  useEffect(() => {
    if (!product) return;
    if (pendingFeatureOpen && pendingFeatureOpen.productId === product.id) {
      const v = consumeFeatureOpen();
      if (v) {
        setTab("features");
        setOpenFeatureId(v.featureId);
      }
    }
  }, [pendingFeatureOpen, product, consumeFeatureOpen]);

  const phase = product ? statusToPhase(product.meta.status) : "in-progress";
  const tabs = useMemo(() => (product ? tabsForPhase(phase) : []), [product, phase]);
  const currentTab = useMemo(
    () => tabs.find((t) => t.key === tab) ?? tabs[0],
    [tab, tabs]
  );

  // 如果当前选中的 tab 不在 phase 允许列表里(例如切换 phase 后),回退到第一个
  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.key === tab)) {
      setTab(tabs[0].key);
    }
  }, [tabs, tab]);

  if (!product) {
    return <main className="p-6 text-sm text-slate-500">暂无产品数据</main>;
  }

  const readOnly = currentTab?.mode === "read-only";

  return (
    <main className="min-h-0 overflow-auto bg-slate-50">
      <ProductStatusBar product={product} />
      <section className="border-b border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{product.meta.theme}</span>
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
          <MetaInline label="源路径" value={product.meta.source_path ?? "—"} />
          <MetaInline label="部署" value={product.meta.deploy_url ?? "未部署"} />
          {product.meta.organization ? (
            <MetaInline label="机构" value={product.meta.organization} />
          ) : null}
          {product.meta.business_domain ? (
            <MetaInline label="业务" value={product.meta.business_domain} />
          ) : null}
          {product.meta.campuses && product.meta.campuses.length > 0 ? (
            <MetaInline label="校区" value={product.meta.campuses.join(" · ")} />
          ) : null}
          {product.meta.tech_lead ? (
            <MetaInline label="技术负责人" value={product.meta.tech_lead} />
          ) : null}
          {product.meta.decision_makers && product.meta.decision_makers.length > 0 ? (
            <MetaInline label="决策方" value={product.meta.decision_makers.join(" + ")} />
          ) : null}
          {product.meta.roadmap_phase ? (
            <MetaInline label="当前阶段" value={product.meta.roadmap_phase} />
          ) : null}
          {product.meta.doc_version ? (
            <MetaInline label="文档版本" value={product.meta.doc_version} />
          ) : null}
        </dl>
      </section>
      <ReviewDashboard productId={product.id} />
      {statusToPhase(product.meta.status) === "in-progress" ? (
        <AgentTasksPanel productId={product.id} />
      ) : null}

      <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-6">
        {tabs.map((t) => {
          const active = t.key === tab;
          return (
            <button
              className={`-mb-px border-b-2 px-3 py-2.5 text-sm transition ${
                active
                  ? "border-slate-900 font-semibold text-slate-950"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
              key={t.key}
              onClick={() => setTab(t.key)}
              type="button"
            >
              {TAB_LABELS[t.key]}
              {t.mode === "read-only" ? (
                <span className="ml-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-normal text-slate-500">
                  只读
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {tab === "features" ? (
        <FeatureTab productId={product.id} readOnly={readOnly} />
      ) : null}
      {tab === "overview" ? <OverviewSection product={product} phase={phase} /> : null}
      {tab === "spec" ? <SpecTab productId={product.id} readOnly={readOnly} /> : null}
      {tab === "entities" ? <EntityTab productId={product.id} readOnly={readOnly} /> : null}
      {tab === "actors" ? <ActorTab productId={product.id} readOnly={readOnly} /> : null}
      {tab === "matrix" ? <MatrixTab productId={product.id} readOnly={readOnly} /> : null}
      {tab === "conventions" ? (
        <ConventionsTab productId={product.id} readOnly={readOnly} />
      ) : null}
      {tab === "design" ? (
        <DesignTab
          onOpenDesign={(name) => {
            setTab("design");
            setOpenDesignName(name);
          }}
          openName={openDesignName}
          productId={product.id}
          readOnly={readOnly}
        />
      ) : null}

      <FeatureDrawer
        featureId={openFeatureId}
        onClose={() => setOpenFeatureId(null)}
        onOpenDesign={(name) => {
          setOpenFeatureId(null);
          setTab("design");
          setOpenDesignName(name);
        }}
        productId={product.id}
        productPhase={phase}
        readOnly={readOnly}
      />
    </main>
  );
}

function OverviewSection({
  product,
  phase
}: {
  product: Product;
  phase: ReturnType<typeof statusToPhase>;
}) {
  const summary = extractSection(product.statusMarkdown, "当前状态");
  const blockers = extractSection(product.statusMarkdown, "阻塞");
  const flowchart = extractSection(product.statusMarkdown, "流程图");
  // 立项阶段(discovering + planning,统一映射为 phase=planning)不挂 git:源代码还没起,GitHub 数据无意义。
  const showGit = phase !== "planning";

  return (
    <section className="space-y-4 p-6">
      <VisionPanel productId={product.id} />

      {summary ? (
        <Card title="当前状态">
          <SummaryBody markdown={summary} />
        </Card>
      ) : null}

      <FeaturesOverview product={product} />

      <TodoBoard />

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

      {showGit ? (
        <>
          <CommitList productId={product.id} />
          <GitHubPanel productId={product.id} rawRepo={product.meta.repo} />
        </>
      ) : null}

      {/* 附加规格文档(SPEC-V1.md / SEAMS.md / DECISIONS.md / 等):立项阶段最有用 */}
      <AdditionalDocsPanel
        defaultExpanded={phase === "planning" ? ["SPEC-V1.md"] : []}
        productId={product.id}
      />
    </section>
  );
}

/**
 * 概览 tab 的"功能点速览"区。
 * - 新结构产品(modules/features 树):按模块分组渲染 feature 名,带 ⚠ 标记
 * - 老结构产品(只有 STATUS.md):回退到 FeatureTable 6 列表
 */
function FeaturesOverview({ product }: { product: Product }) {
  const [data, setData] = useState<ModuleWithFeatures[] | null>(null);
  const productId = product.id;

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/modules-with-features`);
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<ModuleWithFeatures[]>;
      setData(json.data);
    } catch {
      /* 老产品或错误 → 留 null,走 fallback */
    }
  }, [productId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  const useTree = data !== null && data.length > 0;
  const totalFeatures = useTree ? data!.reduce((a, m) => a + m.features.length, 0) : 0;

  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-slate-950">
        功能点
        {useTree ? (
          <span className="ml-2 text-xs font-normal text-slate-500">
            {data!.length} 个模块 · {totalFeatures} 个功能点
          </span>
        ) : null}
      </h2>
      {useTree ? (
        <div className="space-y-2">
          {data!.map((mw) => (
            <div key={mw.module.name} className="rounded-md border border-slate-200 bg-white px-3 py-2">
              <div className="text-xs font-semibold text-slate-700">
                {mw.module.title || mw.module.name}
                <span className="ml-1 font-normal text-slate-400">
                  · {mw.features.length}
                </span>
              </div>
              {mw.features.length === 0 ? (
                <div className="mt-1 text-[11px] italic text-slate-400">(无功能点)</div>
              ) : (
                <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-slate-700">
                  {mw.features.map((f) => (
                    <li key={f.id} className="inline-flex items-center gap-1">
                      <span>{f.name}</span>
                      {f.needs_revision || f.feedbackCount > 0 ? (
                        <span
                          className="text-amber-600"
                          title={`${f.feedbackCount} 条反馈待处理`}
                        >
                          ⚠
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      ) : (
        <FeatureTable features={product.features} productId={product.id} />
      )}
    </div>
  );
}

/**
 * VISION.md(Layer 1)展示卡片。
 *
 * - 文件存在 → 在概览顶部渲染完整 markdown
 * - 文件不存在 → 不渲染(避免给所有产品挂空状态卡)
 *
 * 与 SUMMARY.md 分工:VISION 是客户视角的产品愿景,SUMMARY 是 Agent 视角的 intake 小结。
 */
function VisionPanel({ productId }: { productId: string }) {
  const [vision, setVision] = useState<ProductVision | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/products/${productId}/vision`);
      if (!res.ok) return;
      const json = (await res.json()) as ApiEnvelope<ProductVision>;
      setVision(json.data);
    } catch {
      /* 加载失败时静默,概览页其他区块照常 */
    }
  }, [productId]);

  useEffect(() => {
    setVision(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (!vision || !vision.exists) return null;
  return (
    <Card title="🎯 愿景">
      <MarkdownRenderer markdown={vision.content} />
    </Card>
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
