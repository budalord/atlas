import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ApiEnvelope,
  DerivedEntitiesData,
  DerivedEntity,
  DerivedEntityQuestionsData,
  EntityQuestion
} from "../../types";
import { useDataChange } from "../../lib/useDataChange";
import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { PromptModalDialog } from "../PromptModalDialog";
import { AgentTaskTriggers } from "../AgentTaskTriggers";

interface EntityTabProps {
  productId: string;
  readOnly?: boolean;
}

// agent 内部 bookkeeping question(归属表同步等)— feature 字段为 (cross) 表示不绑定具体 feature
function isBookkeepingQuestion(q: EntityQuestion): boolean {
  return q.feature === "(cross)" || q.module === "(cross)";
}

// 移除老数据里的 `## 给决策者` H2 段(rev3 后实体卡只展示 schema, 决策走顶部 question)
// 老数据被本函数 client-side 隐藏; 下次 entity-derive 跑过后, agent 直接不写这段
function stripDecisionMakerView(body: string): string {
  return body.replace(/^##\s+给决策者[\s\S]*?(?=^##\s+|\s*$(?![\s\S]))/m, "").trim();
}

/**
 * 实体 tab — master-detail 视图。
 *
 * 左侧 list 全部实体名 + layer + features count, 点击选中;
 * 右侧 schema 视图(字段表 / 状态机 / 引用决策 / 引用接缝)。
 *
 * 决策入口统一在顶部 待决策 question 段, 实体卡本身不承载审核/决策。
 */
export function EntityTab({ productId, readOnly = false }: EntityTabProps) {
  const [entitiesData, setEntitiesData] = useState<DerivedEntitiesData | null>(null);
  const [questionsData, setQuestionsData] = useState<DerivedEntityQuestionsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch(`/api/products/${productId}/derived-entities`),
        fetch(`/api/products/${productId}/derived-entities/questions`)
      ]);
      if (!r1.ok) throw new Error(`derived-entities ${r1.status}`);
      if (!r2.ok) throw new Error(`questions ${r2.status}`);
      const e = (await r1.json()) as ApiEnvelope<DerivedEntitiesData>;
      const q = (await r2.json()) as ApiEnvelope<DerivedEntityQuestionsData>;
      setEntitiesData(e.data);
      setQuestionsData(q.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    setEntitiesData(null);
    setQuestionsData(null);
    setSelectedName(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  // 默认选中第一个实体
  useEffect(() => {
    if (selectedName !== null) return;
    const first = entitiesData?.entities[0]?.name;
    if (first) setSelectedName(first);
  }, [entitiesData, selectedName]);

  const allQuestions = questionsData?.questions ?? [];
  const businessQuestions = useMemo(
    () => allQuestions.filter((q) => !isBookkeepingQuestion(q)),
    [allQuestions]
  );
  const bookkeepingQuestions = useMemo(
    () => allQuestions.filter(isBookkeepingQuestion),
    [allQuestions]
  );
  const pendingBusinessCount = businessQuestions.filter((q) => q.status === "pending").length;

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;
  if (entitiesData === null) return <div className="p-5 text-xs text-slate-500">加载中...</div>;

  const entities = entitiesData.entities;
  const selectedEntity = entities.find((e) => e.name === selectedName) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <SimpleBanner
        entityCount={entities.length}
        pendingBusinessCount={pendingBusinessCount}
      />

      <GlobalFeedbackPanel productId={productId} scope="entity" />

      <ToolBar
        entitiesData={entitiesData}
        readOnly={readOnly}
        onOpenPrompt={() => setPromptOpen(true)}
      />

      {!readOnly ? (
        <AgentTaskTriggers
          className="px-5 pb-2"
          productId={productId}
          triggers={[
            { label: "派生实体", kinds: ["entity-derive"] },
            { label: "更新实体", kinds: ["entity-revise"] }
          ]}
        />
      ) : null}

      {entitiesData.stale ? (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-[12px] text-amber-900">
          派生已过期:{entitiesData.stale_reason}
        </div>
      ) : null}

      {questionsData && questionsData.exists && businessQuestions.length > 0 ? (
        <QuestionsSection
          productId={productId}
          questions={businessQuestions}
          allQuestionsIndex={allQuestions}
          title="待决策 question"
          readOnly={readOnly}
          onChanged={() => void load()}
        />
      ) : null}

      {questionsData && questionsData.exists && bookkeepingQuestions.length > 0 ? (
        <details className="border-b border-slate-200 bg-slate-50/60">
          <summary className="cursor-pointer px-5 py-2 text-[11px] text-slate-600">
            ▸ {bookkeepingQuestions.length} 个 agent 内部 bookkeeping question(归属表同步等, 通常 agent 自决)
          </summary>
          <QuestionsSection
            productId={productId}
            questions={bookkeepingQuestions}
            allQuestionsIndex={allQuestions}
            title=""
            readOnly={readOnly}
            onChanged={() => void load()}
            compact
          />
        </details>
      ) : null}

      {!entitiesData.exists ? (
        <EmptyState onOpenPrompt={() => setPromptOpen(true)} readOnly={readOnly} />
      ) : (
        // master-detail: 左 list 正常 flow (跟随 main 滚动), 右 detail sticky 在视口顶端,
        // 不管用户滚到列表多深, 右侧详情始终可见
        <div className="flex flex-1 items-start">
          <EntityList
            entities={entities}
            selectedName={selectedName}
            onSelect={setSelectedName}
          />
          <div className="sticky top-0 max-h-screen flex-1 self-start overflow-y-auto">
            <EntityDetail entity={selectedEntity} />
          </div>
        </div>
      )}

      {promptOpen ? (
        <PromptModalDialog
          mode="generate"
          onClose={() => setPromptOpen(false)}
          productId={productId}
          scope="entity-derive"
        />
      ) : null}
    </div>
  );
}

/* ============================================================
 *  顶部简单 banner — 只显示总数 + 待决策 question 数
 * ============================================================ */
function SimpleBanner({
  entityCount,
  pendingBusinessCount
}: {
  entityCount: number;
  pendingBusinessCount: number;
}) {
  if (entityCount === 0) return null;
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-[12px] text-slate-700">
      <span className="font-semibold text-slate-900">{entityCount}</span> 个派生实体
      {pendingBusinessCount > 0 ? (
        <span className="ml-3">
          · 待决策{" "}
          <span className="font-semibold text-amber-700">{pendingBusinessCount}</span> 个 question
        </span>
      ) : (
        <span className="ml-3 text-emerald-700">· 0 待决策 question</span>
      )}
    </div>
  );
}

/* ============================================================
 *  顶部工具栏
 * ============================================================ */
function ToolBar({
  entitiesData,
  readOnly,
  onOpenPrompt
}: {
  entitiesData: DerivedEntitiesData;
  readOnly: boolean;
  onOpenPrompt: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-5 py-2">
      <div className="text-[11px] text-slate-500">
        {entitiesData.exists ? (
          entitiesData.generated_at ? (
            <span>生成于 {formatTime(entitiesData.generated_at)}</span>
          ) : null
        ) : (
          <span>尚无派生实体</span>
        )}
      </div>
      {!readOnly ? (
        <button
          className="rounded border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-900 hover:text-slate-900"
          onClick={onOpenPrompt}
          title="生成派生 prompt(复制后给 agent 跑) — 读功能点+规格+我已决策的需求"
          type="button"
        >
          {entitiesData.exists ? "更新实体" : "生成实体"}(读功能点 + 我的决策)
        </button>
      ) : null}
    </div>
  );
}

function EmptyState({ onOpenPrompt, readOnly }: { onOpenPrompt: () => void; readOnly: boolean }) {
  return (
    <div className="m-5 rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-[13px] leading-6 text-slate-600">
      <div className="text-[14px] font-medium text-slate-900">尚未生成派生实体</div>
      <div className="mt-1 text-slate-500">
        Path C 派生从 features + SEAMS + DECISIONS + ENTITIES-OWNERSHIP + 全局需求池(entity)派生实体清单。
      </div>
      {!readOnly ? (
        <button
          className="mt-3 rounded bg-slate-900 px-4 py-1.5 text-[12px] text-white hover:bg-slate-800"
          onClick={onOpenPrompt}
          type="button"
        >
          复制派生 prompt
        </button>
      ) : null}
    </div>
  );
}

/* ============================================================
 *  实体列表(左侧 master) — 按 layer 分组, 点击切换
 * ============================================================ */
function EntityList({
  entities,
  selectedName,
  onSelect
}: {
  entities: DerivedEntity[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}) {
  // 按 layer 分组, layer 内按名字字典序
  const groups = useMemo(() => {
    const map = new Map<string, DerivedEntity[]>();
    for (const e of entities) {
      const k = e.layer || "[TBD]";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.name.localeCompare(b.name));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entities]);

  return (
    <nav className="w-60 shrink-0 border-r border-slate-200 bg-slate-50">
      {groups.map(([layer, group]) => (
        <div key={layer}>
          <div className="sticky top-0 border-b border-slate-200 bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {layer}
            <span className="ml-1 font-normal text-slate-400">{group.length}</span>
          </div>
          <ul>
            {group.map((e) => (
              <li key={e.name}>
                <button
                  className={`block w-full border-b border-slate-100 px-3 py-1.5 text-left text-[12px] font-mono leading-tight hover:bg-white ${
                    selectedName === e.name
                      ? "bg-white text-slate-900"
                      : "text-slate-700"
                  }`}
                  onClick={() => onSelect(e.name)}
                  type="button"
                >
                  {e.name}
                  <div className="mt-0.5 font-sans text-[10px] text-slate-400">
                    features × {e.sourceFeatures.length}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ============================================================
 *  实体详情(右侧 detail) — 纯 schema 视图
 * ============================================================ */
function EntityDetail({ entity }: { entity: DerivedEntity | null }) {
  if (!entity) {
    return (
      <div className="flex flex-1 items-center justify-center text-[12px] text-slate-400">
        从左侧选一个实体查看 schema
      </div>
    );
  }
  const schemaBody = stripDecisionMakerView(entity.body);
  return (
    <div className="bg-white">
      <header className="border-b border-slate-200 px-5 py-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[16px] font-semibold text-slate-900">
            {entity.name}
          </span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
            {entity.layer}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          维护: {entity.maintainers} · features × {entity.sourceFeatures.length}
          {entity.sourceSeams.length > 0 ? ` · seams × ${entity.sourceSeams.length}` : ""}
          {entity.sourceDecisions.length > 0
            ? ` · decisions × ${entity.sourceDecisions.length}`
            : ""}
        </div>
      </header>

      <div className="px-5 py-4">
        <div className="prose prose-sm max-w-none text-[12px]">
          <MarkdownRenderer markdown={schemaBody} />
        </div>
        {entity.sourceFeatures.length > 0 ? (
          <div className="mt-4 border-t border-slate-200 pt-3 text-[11px]">
            <div className="text-slate-500">来源 features:</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {entity.sourceFeatures.map((f) => (
                <code
                  key={f}
                  className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-700"
                >
                  {f}
                </code>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ============================================================
 *  Questions section · 一级展示, 每条 3 按钮决策
 * ============================================================ */
function QuestionsSection({
  productId,
  questions,
  allQuestionsIndex,
  title,
  readOnly,
  onChanged,
  compact = false
}: {
  productId: string;
  questions: EntityQuestion[];
  allQuestionsIndex: EntityQuestion[];
  title: string;
  readOnly: boolean;
  onChanged: () => void;
  compact?: boolean;
}) {
  const pending = questions.filter((q) => q.status === "pending");
  const decided = questions.filter((q) => q.status !== "pending");

  return (
    <section className={compact ? "" : "border-b border-slate-200 bg-white"}>
      {title ? (
        <header className="flex items-center justify-between bg-amber-50/60 px-5 py-2">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-medium text-slate-900">
              {title} {questions.length} 条
            </span>
            <span className="text-slate-500">
              · 待决策 {pending.length} · 已决策 {decided.length}
            </span>
          </div>
        </header>
      ) : null}

      <ul className="divide-y divide-slate-100">
        {questions.map((q) => {
          const idx = allQuestionsIndex.indexOf(q);
          return (
            <QuestionRow
              key={`${idx}-${q.question.slice(0, 20)}`}
              idx={idx}
              question={q}
              productId={productId}
              readOnly={readOnly}
              onChanged={onChanged}
            />
          );
        })}
      </ul>
    </section>
  );
}

function QuestionRow({
  idx,
  question,
  productId,
  readOnly,
  onChanged
}: {
  idx: number;
  question: EntityQuestion;
  productId: string;
  readOnly: boolean;
  onChanged: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customText, setCustomText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const decided = question.status !== "pending";

  const decide = async (body: Record<string, unknown>) => {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/derived-entities/questions/${idx}/decide`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      setCustomOpen(false);
      setCustomText("");
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "决策失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <li className={`px-5 py-2.5 ${decided ? "bg-slate-50/60" : ""}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded bg-slate-200 px-1 text-[10px] font-mono text-slate-700">
          {idx + 1}
        </span>
        <div className="flex-1">
          <div className={`text-[13px] leading-5 ${decided ? "text-slate-500" : "text-slate-900"}`}>
            {question.question}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
            <span>feature: {question.feature}</span>
            <span>module: {question.module}</span>
            <span>
              trigger: <code className="font-mono">{question.trigger.feature_path}</code>
            </span>
          </div>
          {question.proposed_resolution && !decided ? (
            <div className="mt-1 rounded border border-emerald-200 bg-emerald-50/60 px-2 py-1 text-[11px] text-emerald-800">
              agent 建议:{question.proposed_resolution}
            </div>
          ) : null}
          {decided ? (
            <div className="mt-1 text-[11px] text-slate-600">
              {question.status === "accepted" ? (
                <span className="text-emerald-700">✓ 已接受建议 → 落全局需求池 {question.resolvedGfbId}</span>
              ) : question.status === "custom" ? (
                <span className="text-emerald-700">✎ 已自定义决策 → 落全局需求池 {question.resolvedGfbId}</span>
              ) : (
                <span className="text-slate-500">× 已驳回(不是业务问题)</span>
              )}
              {question.resolution ? (
                <span className="ml-2 text-slate-500">· {question.resolution}</span>
              ) : null}
            </div>
          ) : null}

          {!decided && customOpen ? (
            <form
              className="mt-2 rounded border border-amber-200 bg-white px-2 py-2"
              onSubmit={(e) => {
                e.preventDefault();
                void decide({ action: "custom", customContent: customText });
              }}
            >
              <textarea
                autoFocus
                className="w-full resize-none rounded border border-slate-300 px-2 py-1 text-[12px] leading-5"
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="写你自己的决策内容(下一轮重派生时, agent 会按这个执行)..."
                rows={3}
                value={customText}
              />
              <div className="mt-1 flex justify-end gap-2">
                <button
                  className="rounded px-2 py-0.5 text-[11px] text-slate-600 hover:text-slate-900"
                  onClick={() => {
                    setCustomOpen(false);
                    setCustomText("");
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className="rounded bg-emerald-700 px-3 py-0.5 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                  disabled={submitting || customText.trim().length === 0}
                  type="submit"
                >
                  {submitting ? "提交中..." : "确认决策"}
                </button>
              </div>
            </form>
          ) : null}

          {err ? (
            <div className="mt-1 text-[11px] text-rose-700">{err}</div>
          ) : null}
        </div>

        {!decided && !readOnly && !customOpen ? (
          <div className="flex shrink-0 flex-col gap-1">
            {question.proposed_resolution ? (
              <button
                className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-800 hover:border-emerald-500 disabled:opacity-50"
                disabled={submitting}
                onClick={() => void decide({ action: "accept" })}
                title="接受 agent 建议 → 写入全局需求池 entity 段"
                type="button"
              >
                ✓ 接受建议
              </button>
            ) : null}
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-slate-500 disabled:opacity-50"
              disabled={submitting}
              onClick={() => setCustomOpen(true)}
              type="button"
            >
              ✎ 自定义
            </button>
            <button
              className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-rose-400 hover:text-rose-700 disabled:opacity-50"
              disabled={submitting}
              onClick={() => {
                const reason = window.prompt("驳回原因(非业务问题 / agent 抛错了等):") ?? "";
                if (!reason.trim()) return;
                void decide({ action: "reject", reason });
              }}
              title="不是业务问题 → 写入 questions-decisions.yml, 下轮不再抛"
              type="button"
            >
              × 驳回
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toISOString().slice(0, 16).replace("T", " ");
  } catch {
    return iso;
  }
}
