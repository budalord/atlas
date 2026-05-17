import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiEnvelope, FlowchartData, FlowchartQuestion } from "../types";
import { MermaidBlock } from "./MermaidBlock";
import { PromptModalDialog } from "./PromptModalDialog";

interface FlowchartViewProps {
  productId: string;
  /** 用户点 questions.md 横幅里"打开功能点"时回调,父组件负责挂 FeatureModal */
  onOpenFeature: (moduleId: string, featureId: string) => void;
}

/**
 * 流程图视图(衍生产物,只读)。
 *
 * 三个原则:
 *  1. 任何编辑入口都不暴露 — Mermaid 节点不可拖动、不可改文案、无文本编辑器
 *  2. 流程图状态由 GET /api/products/:id/flowchart 完全决定;用户答复唯一路径是回功能点 tab 改 feature.md
 *  3. questions.md 是一等公民:横幅 + 跳转到 FeatureModal,闭合"模糊宁可缺"反馈循环
 */
export function FlowchartView({ productId, onOpenFeature }: FlowchartViewProps) {
  const [data, setData] = useState<FlowchartData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/flowchart`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<FlowchartData>;
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const questionsCount = data?.questions.length ?? 0;
  const lintOk = data?.questions_lint_ok ?? true;
  const lintErrors = data?.questions_lint_errors ?? [];

  return (
    <div className="flex h-full flex-col bg-slate-50">
      {/* 顶部固定提示条 — 强化"派生产物"语义 */}
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12px] text-amber-900">
        ⚙ 此图由功能点 tab 派生,发现问题请回上面修改后重新生成。
      </div>

      {/* 操作行:左侧元信息 + 右侧按钮 */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-2 text-[12px] text-slate-600">
        <FlowchartMeta data={data} loading={loading} error={error} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded border px-3 py-1 text-[12px] font-medium ${
              data?.stale
                ? "border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => setPromptOpen(true)}
            title="把功能点+roles+contract 拼成 prompt 给 Codex/Claude 跑"
          >
            📋 复制生成提示词
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
            onClick={() => void load()}
            title="Agent 跑完后点这里重读 main.mmd"
          >
            ↻ 刷新
          </button>
        </div>
      </div>

      {/* questions.md 横幅 — 一等公民,缺被看到 → 用户回 source 修改 → 重生成验证 */}
      {questionsCount > 0 || !lintOk ? (
        <QuestionsBanner
          questions={data?.questions ?? []}
          lintOk={lintOk}
          lintErrors={lintErrors}
          expanded={questionsExpanded}
          onToggle={() => setQuestionsExpanded((v) => !v)}
          onOpenFeature={onOpenFeature}
        />
      ) : null}

      {/* 主区域:渲染 / 空状态 / 错误 / contract 违规 */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {loading ? (
          <div className="py-10 text-center text-xs text-slate-500">加载中...</div>
        ) : error ? (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : !data?.exists ? (
          <EmptyState onOpenPrompt={() => setPromptOpen(true)} />
        ) : !lintOk ? (
          // contract §6.3 兜底机制失守 → 整份 .mmd 视作不可信(下游派生 Agent 也会拒绝消费)。
          // 前端的信任判断必须和下游消费判断保持一致 —— 不渲染 mermaid,避免用户照着错图推进。
          <ContractViolationPlaceholder
            errorCount={lintErrors.length}
            onOpenPrompt={() => setPromptOpen(true)}
          />
        ) : (
          <div
            className="rounded border border-slate-200 bg-white p-2"
            // 阻止节点上任何拖拽/选择/双击 — 衍生产物不允许用户在 UI 上做任何修改语义的操作
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={(e) => e.preventDefault()}
          >
            <MermaidBlock code={data.mermaid ?? ""} />
          </div>
        )}
      </div>

      {promptOpen ? (
        <PromptModalDialog
          mode="generate"
          scope="flowchart"
          productId={productId}
          onClose={() => {
            setPromptOpen(false);
            // 用户跑完 Agent 后关闭 modal,这里顺手刷新一次拿最新 main.mmd
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function FlowchartMeta({
  data,
  loading,
  error
}: {
  data: FlowchartData | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <span className="text-slate-400">加载中...</span>;
  if (error) return <span className="text-rose-600">{error}</span>;
  if (!data) return null;
  if (!data.exists) {
    return <span className="text-slate-400">尚未生成 main.mmd</span>;
  }
  const generatedAt = data.generated_at ? new Date(data.generated_at) : null;
  const tsLabel = generatedAt
    ? `${generatedAt.toLocaleString("zh-CN", { hour12: false })}`
    : "未知时间";
  return (
    <div className="flex items-center gap-2">
      <span>上次生成: {tsLabel}</span>
      {data.stale ? (
        <span
          className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
          title={data.stale_reason ?? undefined}
        >
          ⚠ 已过期
        </span>
      ) : null}
    </div>
  );
}

interface QuestionsBannerProps {
  questions: FlowchartQuestion[];
  lintOk: boolean;
  lintErrors: string[];
  expanded: boolean;
  onToggle: () => void;
  onOpenFeature: (moduleId: string, featureId: string) => void;
}

function QuestionsBanner({
  questions,
  lintOk,
  lintErrors,
  expanded,
  onToggle,
  onOpenFeature
}: QuestionsBannerProps) {
  const tone = !lintOk
    ? "border-rose-300 bg-rose-50 text-rose-900"
    : "border-orange-300 bg-orange-50 text-orange-900";
  return (
    <div className={`border-b ${tone}`}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-2 text-[12px] font-medium"
        onClick={onToggle}
      >
        <span>
          {!lintOk ? (
            <>
              ⛔ 流程图产出含非法 question(trigger 引文与 feature.md 不匹配,
              共 {lintErrors.length} 条),需重跑或人工 review
            </>
          ) : (
            <>⚠ {questions.length} 个问题待澄清,可能影响流程图完整性</>
          )}
        </span>
        <span className="text-[11px] opacity-70">
          {expanded ? "收起 ▲" : "展开 ▼"}
        </span>
      </button>
      {expanded ? (
        <div className="space-y-2 px-5 pb-3 text-[12px]">
          {!lintOk
            ? lintErrors.map((err, i) => (
                <div
                  key={`lint-${i}`}
                  className="rounded border border-rose-300 bg-white px-3 py-2 text-rose-800"
                >
                  {err}
                </div>
              ))
            : null}
          {questions.map((q) => (
            <QuestionCard key={`${q.feature}-${q.question.slice(0, 24)}`} q={q} onOpenFeature={onOpenFeature} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function QuestionCard({
  q,
  onOpenFeature
}: {
  q: FlowchartQuestion;
  onOpenFeature: (moduleId: string, featureId: string) => void;
}) {
  const featureFile = useMemo(() => {
    const match = q.trigger.feature_path.match(/\/([^/]+)\/features\/([^/]+)\.md$/);
    if (!match) return null;
    return { moduleId: match[1], featureId: match[2] };
  }, [q.trigger.feature_path]);
  const sourceLabel = q.trigger.feature_path.replace(/^.*\/modules\//, "modules/");
  return (
    <div className="rounded border border-orange-300 bg-white px-3 py-2">
      <div className="text-[13px] font-medium text-slate-900">{q.question}</div>
      <blockquote className="mt-1 border-l-2 border-orange-300 pl-2 text-[12px] italic text-slate-600">
        "{q.trigger.original_text}"
        <span className="ml-2 text-[11px] not-italic text-slate-400">— {sourceLabel}</span>
      </blockquote>
      {q.proposed_resolution ? (
        <details className="mt-1 text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none">Agent 的建议</summary>
          <div className="mt-1 whitespace-pre-wrap pl-3">{q.proposed_resolution}</div>
        </details>
      ) : null}
      <div className="mt-2">
        {featureFile ? (
          <button
            type="button"
            className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-white"
            onClick={() => onOpenFeature(featureFile.moduleId, featureFile.featureId)}
            title="跳到对应 feature,修改 description/roles 后回流程图重新生成"
          >
            打开功能点 → {featureFile.moduleId} / {featureFile.featureId}
          </button>
        ) : (
          <span className="text-[11px] text-rose-600">
            trigger.feature_path 解析失败,无法跳转
          </span>
        )}
      </div>
    </div>
  );
}

function ContractViolationPlaceholder({
  errorCount,
  onOpenPrompt
}: {
  errorCount: number;
  onOpenPrompt: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded border-2 border-rose-300 bg-rose-50 py-16 text-rose-900">
      <div className="text-base font-semibold">⛔ Contract 违规,流程图整体不可信</div>
      <div className="max-w-lg text-center text-[12px] leading-5 text-rose-700">
        main.questions.md 中有 <span className="font-semibold">{errorCount}</span>{" "}
        条 question 的 trigger.original_text 在对应 feature.md 中 grep 不到——这意味着
        Agent 编造了 description 里不存在的原文,触发了 contract §6.3.4 lint 失败。
        <br />
        <br />
        Per contract §6.3:整份 main.mmd 在下游派生 Agent 处也会被拒绝消费,故前端
        不渲染流程图,避免你照着错图推进。展开上方红色横幅查看具体非法条目,然后重跑生成。
      </div>
      <button
        type="button"
        className="rounded-lg border-2 border-rose-700 bg-white px-5 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-700 hover:text-white"
        onClick={onOpenPrompt}
      >
        📋 复制生成提示词重跑
      </button>
    </div>
  );
}

function EmptyState({ onOpenPrompt }: { onOpenPrompt: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-16 text-slate-500">
      <div className="text-sm">还没有生成过流程图</div>
      <div className="max-w-md text-center text-xs leading-5 text-slate-400">
        点右上角 <span className="font-medium text-slate-700">📋 复制生成提示词</span>{" "}
        → 用 Codex/Claude 跑完 → 回来点 ↻ 刷新
      </div>
      <button
        type="button"
        className="rounded-lg border-2 border-slate-900 bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-900 hover:text-white"
        onClick={onOpenPrompt}
      >
        📋 复制生成提示词
      </button>
    </div>
  );
}
