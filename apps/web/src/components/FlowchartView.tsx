import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ApiEnvelope,
  FlowchartQuestion,
  ModuleFlowchartData,
  ModuleFlowchartListData
} from "../types";
import { MermaidBlock } from "./MermaidBlock";
import { PromptModalDialog } from "./PromptModalDialog";

interface FlowchartViewProps {
  productId: string;
  /** 用户点 questions.md 横幅里"打开功能点"时回调,父组件负责挂 FeatureModal */
  onOpenFeature: (moduleId: string, featureId: string) => void;
}

/**
 * 决策者流程图视图(per-module 切分版)。
 *
 * 与老版(单 main.mmd + 角色 swimlane)的差异:
 *  - 每个 module 一张 .mmd(节点 = feature,subgraph = module_group)
 *  - tab UI 切换 7 个模块,避免 42 features 拍一张图爆炸
 *  - 数据源:GET /api/products/:id/flowcharts/by-module
 *  - questions.md 仍然是一等公民(聚合一份),横幅 + 跳转到 feature
 *  - 任何编辑入口都不暴露(节点不可拖、不可改、无文本编辑)
 *  - 生成 = 复制提示词 → Codex → 写文件 → 刷新
 */
export function FlowchartView({ productId, onOpenFeature }: FlowchartViewProps) {
  const [data, setData] = useState<ModuleFlowchartListData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [questionsExpanded, setQuestionsExpanded] = useState(false);
  /** 当前 tab 选中的 moduleId;null = 默认选第一个有 mmd 的 module */
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/products/${productId}/flowchart/by-module`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiEnvelope<ModuleFlowchartListData>;
      setData(json.data);
      // 默认选第一个 exists 的 module(或第一个 module)
      if (activeModuleId === null && json.data.modules.length > 0) {
        const firstExisting = json.data.modules.find((m) => m.exists);
        setActiveModuleId(firstExisting?.moduleId ?? json.data.modules[0].moduleId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [productId, activeModuleId]);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const activeModule = useMemo<ModuleFlowchartData | null>(() => {
    if (!data || !activeModuleId) return null;
    return data.modules.find((m) => m.moduleId === activeModuleId) ?? null;
  }, [data, activeModuleId]);

  const questionsCount = data?.questions.length ?? 0;
  const lintOk = data?.questions_lint_ok ?? true;
  const lintErrors = data?.questions_lint_errors ?? [];
  const totalModules = data?.modules.length ?? 0;
  const existingCount = data?.modules.filter((m) => m.exists).length ?? 0;
  const staleCount = data?.modules.filter((m) => m.stale).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      {/* 顶部固定提示条 — 强化"派生产物 + 决策者视角"语义 */}
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12px] text-amber-900">
        ⚙ 决策者视角流程图(per-module 切分)· 派生自功能点 tab · 改 feature 后用 Codex 重新生成
      </div>

      {/* 操作行:左侧元信息 + 右侧按钮 */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-5 py-2 text-[12px] text-slate-600">
        <div className="flex items-center gap-2">
          {loading ? (
            <span className="text-slate-400">加载中...</span>
          ) : error ? (
            <span className="text-rose-600">{error}</span>
          ) : data ? (
            <>
              <span>
                <span className="font-medium text-slate-700">{existingCount}</span>/{totalModules} 模块已生成
              </span>
              {staleCount > 0 ? (
                <span
                  className="rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-900"
                  title="模块下 feature 有改动晚于流程图"
                >
                  ⚠ {staleCount} 个过期
                </span>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={`rounded border px-3 py-1 text-[12px] font-medium ${
              staleCount > 0 || existingCount < totalModules
                ? "border-amber-400 bg-amber-100 text-amber-900 hover:bg-amber-200"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
            onClick={() => setPromptOpen(true)}
            title="把全部功能点 + 触发后续 + 新 contract 拼成 prompt 给 Codex 跑"
          >
            📋 复制生成提示词
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-[12px] text-slate-700 hover:bg-slate-50"
            onClick={() => void load()}
            title="Agent 跑完后点这里重读 by-module/*.mmd"
          >
            ↻ 刷新
          </button>
        </div>
      </div>

      {/* questions 横幅 — 一等公民 */}
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

      {/* 模块 tab 选择器 */}
      {data && data.modules.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 bg-white px-3 py-1.5">
          {data.modules.map((m) => (
            <ModuleTabButton
              key={m.moduleId}
              module={m}
              active={m.moduleId === activeModuleId}
              onClick={() => setActiveModuleId(m.moduleId)}
            />
          ))}
        </div>
      ) : null}

      {/* 主区域:渲染选中的 module / 空状态 / 错误 */}
      <div className="flex-1 overflow-auto px-5 py-4">
        {loading && !data ? (
          <div className="py-10 text-center text-xs text-slate-500">加载中...</div>
        ) : error && !data ? (
          <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        ) : !data || data.modules.length === 0 ? (
          <EmptyNoModulesState />
        ) : !activeModule ? (
          <div className="text-xs text-slate-500">未选中模块</div>
        ) : !activeModule.exists ? (
          <EmptyModuleState
            moduleData={activeModule}
            onOpenPrompt={() => setPromptOpen(true)}
          />
        ) : (
          <div
            className="rounded border border-slate-200 bg-white p-2"
            onContextMenu={(e) => e.preventDefault()}
            onDoubleClick={(e) => e.preventDefault()}
          >
            <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
              {activeModule.moduleTitle || activeModule.moduleId} ·{" "}
              <span className="font-medium text-slate-700">{activeModule.featureCount}</span> features ·
              生成于 {formatGenerated(activeModule.generated_at)}
              {activeModule.stale ? (
                <span
                  className="ml-2 rounded border border-amber-400 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
                  title={activeModule.stale_reason ?? undefined}
                >
                  ⚠ 已过期
                </span>
              ) : null}
            </div>
            <MermaidBlock code={activeModule.mermaid ?? ""} />
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
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

interface ModuleTabButtonProps {
  module: ModuleFlowchartData;
  active: boolean;
  onClick: () => void;
}

function ModuleTabButton({ module: m, active, onClick }: ModuleTabButtonProps) {
  // 视觉规则:active = 黑底白字 / exists = 白底 / 不存在 = 灰底 / stale 加 ⚠
  const baseCls = "rounded px-2.5 py-1 text-[12px] font-medium transition-colors";
  const colorCls = active
    ? "bg-slate-900 text-white hover:bg-slate-800"
    : m.exists
      ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      : "border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:bg-white";
  return (
    <button
      type="button"
      className={`${baseCls} ${colorCls}`}
      onClick={onClick}
      title={
        m.exists
          ? `${m.featureCount} features${m.stale ? " · 已过期" : ""}`
          : `${m.featureCount} features · 尚未生成 .mmd`
      }
    >
      <span>{m.moduleTitle || m.moduleId}</span>
      <span className={`ml-1.5 rounded px-1 text-[10px] ${active ? "bg-slate-700 text-slate-200" : "bg-slate-100 text-slate-500"}`}>
        {m.featureCount}
      </span>
      {m.stale ? <span className="ml-1 text-[10px]">⚠</span> : null}
      {!m.exists ? <span className="ml-1 text-[10px]">·空</span> : null}
    </button>
  );
}

function formatGenerated(iso: string | null): string {
  if (!iso) return "未知时间";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
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
            <>⛔ Questions 含非法 trigger(共 {lintErrors.length} 条),需修后重跑</>
          ) : (
            <>⚠ {questions.length} 个问题待澄清,可能影响流程图完整性</>
          )}
        </span>
        <span className="text-[11px] opacity-70">{expanded ? "收起 ▲" : "展开 ▼"}</span>
      </button>
      {expanded ? (
        <div className="max-h-[40vh] space-y-2 overflow-auto px-5 pb-3 text-[12px]">
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
            <QuestionCard
              key={`${q.feature}-${q.question.slice(0, 24)}`}
              q={q}
              onOpenFeature={onOpenFeature}
            />
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
            title="跳到对应 feature,修改后回流程图重新生成"
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

function EmptyNoModulesState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 py-16 text-slate-500">
      <div className="text-sm">该产品没有模块/功能点树</div>
      <div className="text-xs">先去功能点 tab 建模块和 feature</div>
    </div>
  );
}

function EmptyModuleState({
  moduleData,
  onOpenPrompt
}: {
  moduleData: ModuleFlowchartData;
  onOpenPrompt: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-slate-500">
      <div className="text-sm font-medium text-slate-700">
        {moduleData.moduleTitle || moduleData.moduleId} 还没有 .mmd
      </div>
      <div className="max-w-md text-center text-xs leading-5 text-slate-400">
        该模块下有 {moduleData.featureCount} 个 feature,但流程图尚未生成。
        <br />
        点右上角 <span className="font-medium text-slate-700">📋 复制生成提示词</span> →
        让 Codex 跑完 → 回来点 ↻ 刷新。
      </div>
      <button
        type="button"
        className="rounded-lg border-2 border-slate-900 bg-white px-4 py-1.5 text-xs font-semibold text-slate-900 hover:bg-slate-900 hover:text-white"
        onClick={onOpenPrompt}
      >
        📋 复制生成提示词
      </button>
    </div>
  );
}
