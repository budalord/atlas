import { useCallback, useEffect, useState } from "react";
import type {
  ApiEnvelope,
  DerivedEntitiesData,
  DerivedEntity,
  DerivedEntityQuestionsData,
  EntityQuestion,
  EntityReconcileReport
} from "../../types";
import { useDataChange } from "../../lib/useDataChange";
import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { PromptModalDialog } from "../PromptModalDialog";

interface EntityTabProps {
  productId: string;
  readOnly?: boolean;
}

const NEW_BADGE_DAYS = 7;
function isRecentlyDerived(generated_at: string | null): boolean {
  if (!generated_at) return false;
  const t = Date.parse(generated_at);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < NEW_BADGE_DAYS * 86400 * 1000;
}

// agent 内部 bookkeeping question(归属表同步等) — feature 字段为 (cross) 表示不绑定具体 feature
function isBookkeepingQuestion(q: EntityQuestion): boolean {
  return q.feature === "(cross)" || q.module === "(cross)";
}

// 实体需要决策者亲自审的判定 — 信号是 agent 自己在 `**待你拍**` 段留下了真实勾选项
// (features 已经决过的流程/权限/约束, agent 应该自决, 不该塞回实体)
function countPendingTodos(view: string): number {
  return (view.match(/^\s*-\s*\[\s*\]/gm) ?? []).length;
}

function needsHumanReview(e: DerivedEntity): boolean {
  if (e.layer === "[TBD]" || e.layer.includes("[TBD]")) return true;
  if (e.maintainers === "[TBD]" || e.maintainers.includes("[TBD]")) return true;
  if (!e.decisionMakerView) return true;
  if (countPendingTodos(e.decisionMakerView) > 0) return true;
  return false;
}

function whyCritical(e: DerivedEntity): string {
  const reasons: string[] = [];
  if (e.layer.includes("[TBD]")) reasons.push("归属待定");
  if (e.maintainers.includes("[TBD]")) reasons.push("维护人待定");
  if (!e.decisionMakerView) reasons.push("缺给决策者段");
  const todos = countPendingTodos(e.decisionMakerView);
  if (todos > 0) reasons.push(`${todos} 项待拍`);
  return reasons.join(" · ");
}

/**
 * 实体 tab — 立项最后一道审查关(契约 §8)。
 *
 * 派生即全部:
 *   - 由功能点 + SEAMS + DECISIONS + ENTITIES-OWNERSHIP + GLOBAL-FEEDBACK(entity) 派生
 *   - 不允许手写编辑(派生只读), 但审阅元数据(review-state.yml)与 question 决策可写
 *   - 全部实体已审 + 0 待决策 question → 解锁原型 tab
 */
export function EntityTab({ productId, readOnly = false }: EntityTabProps) {
  const [entitiesData, setEntitiesData] = useState<DerivedEntitiesData | null>(null);
  const [questionsData, setQuestionsData] = useState<DerivedEntityQuestionsData | null>(null);
  const [reconcile, setReconcile] = useState<EntityReconcileReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r1, r2, r3] = await Promise.all([
        fetch(`/api/products/${productId}/derived-entities`),
        fetch(`/api/products/${productId}/derived-entities/questions`),
        fetch(`/api/products/${productId}/derived-entities/reconcile`)
      ]);
      if (!r1.ok) throw new Error(`derived-entities ${r1.status}`);
      if (!r2.ok) throw new Error(`questions ${r2.status}`);
      if (!r3.ok) throw new Error(`reconcile ${r3.status}`);
      const e = (await r1.json()) as ApiEnvelope<DerivedEntitiesData>;
      const q = (await r2.json()) as ApiEnvelope<DerivedEntityQuestionsData>;
      const c = (await r3.json()) as ApiEnvelope<EntityReconcileReport>;
      setEntitiesData(e.data);
      setQuestionsData(q.data);
      setReconcile(c.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    setEntitiesData(null);
    setQuestionsData(null);
    setReconcile(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;
  if (entitiesData === null) return <div className="p-5 text-xs text-slate-500">加载中...</div>;

  const entities = entitiesData.entities;
  const allQuestions = questionsData?.questions ?? [];
  // 按 feature 字段区分业务 question vs 工程 question(agent 元决策)
  const businessQuestions = allQuestions.filter((q) => !isBookkeepingQuestion(q));
  const bookkeepingQuestions = allQuestions.filter(isBookkeepingQuestion);
  const pendingBusinessQuestions = businessQuestions.filter((q) => q.status === "pending");
  const pendingQuestions = allQuestions.filter((q) => q.status === "pending");

  // 实体分组: 需要你拍 vs 机械映射
  // 需要你拍 = 多 feature 合并 / layer-TBD / 缺给决策者段 / 字段含 TBD
  const critical = entities.filter((e) => needsHumanReview(e));
  const mechanical = entities.filter((e) => !needsHumanReview(e));
  const criticalReviewed = critical.filter((e) => e.reviewedAt).length;
  const allCriticalReviewed = critical.length === 0 || criticalReviewed === critical.length;
  const totalEntities = entities.length;
  const gatePassed = allCriticalReviewed && pendingBusinessQuestions.length === 0 && totalEntities > 0;

  return (
    <div className="flex min-h-0 flex-col overflow-auto">
      <GateBanner
        gatePassed={gatePassed}
        criticalReviewed={criticalReviewed}
        criticalTotal={critical.length}
        mechanicalTotal={mechanical.length}
        pendingBusiness={pendingBusinessQuestions.length}
        hasEntities={totalEntities > 0}
      />

      <GlobalFeedbackPanel productId={productId} scope="entity" />

      <ToolBar
        entitiesData={entitiesData}
        readOnly={readOnly}
        onOpenPrompt={() => setPromptOpen(true)}
      />

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
            ▸ {bookkeepingQuestions.length} 个 agent 内部 bookkeeping question(归属表同步等, 通常 agent 自决, 仅在异常时展开)
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
      ) : null}

      {reconcile && reconcile.exists ? (
        <details className="border-b border-slate-200 bg-white px-5 py-2">
          <summary className="cursor-pointer text-[12px] font-medium text-slate-700">
            ▸ Reconcile 报告 · 派生 vs ENTITIES-OWNERSHIP
            <span className="ml-2 text-[11px] font-normal text-slate-500">
              派生有声明无 {reconcile.derivedOnly.length} · 声明有派生无 {reconcile.declaredOnly.length} · 归属不一致 {reconcile.layerMismatch.length}
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-3 text-[12px] lg:grid-cols-3">
            <ReconcileSection diffs={reconcile.derivedOnly} title="派生有声明无" tone="amber" />
            <ReconcileSection diffs={reconcile.declaredOnly} title="声明有派生无" tone="slate" />
            <ReconcileSection diffs={reconcile.layerMismatch} title="归属不一致" tone="rose" />
          </div>
        </details>
      ) : null}

      {critical.length > 0 ? (
        <section className="mx-5 mt-5">
          <header className="mb-2 flex items-center gap-2 text-[12px] font-medium text-slate-700">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
            需要你拍 ({criticalReviewed}/{critical.length} 已审)
            <span className="text-[11px] font-normal text-slate-500">
              · 多 feature 合并 / 归属待定 / 字段有 [TBD] / 缺给决策者段
            </span>
          </header>
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {critical.map((entity) => (
              <li key={entity.name}>
                <EntityCard
                  entity={entity}
                  productId={productId}
                  readOnly={readOnly}
                  onChanged={() => void load()}
                  pendingQuestionsCount={pendingQuestions.length}
                  reason={whyCritical(entity)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {mechanical.length > 0 ? (
        <details className="mx-5 mt-4 mb-5 rounded-md border border-slate-200 bg-slate-50/60">
          <summary className="cursor-pointer px-3 py-2 text-[12px] text-slate-700">
            ▸ {mechanical.length} 个机械映射(1 个 feature 直推 · 默认通过, 不需要单独审)
          </summary>
          <ul className="grid grid-cols-1 gap-3 px-3 pb-3 lg:grid-cols-2">
            {mechanical.map((entity) => (
              <li key={entity.name}>
                <EntityCard
                  entity={entity}
                  productId={productId}
                  readOnly={readOnly}
                  onChanged={() => void load()}
                  pendingQuestionsCount={pendingQuestions.length}
                />
              </li>
            ))}
          </ul>
        </details>
      ) : null}

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
 *  立项 gate 横幅
 * ============================================================ */
function GateBanner({
  gatePassed,
  criticalReviewed,
  criticalTotal,
  mechanicalTotal,
  pendingBusiness,
  hasEntities
}: {
  gatePassed: boolean;
  criticalReviewed: number;
  criticalTotal: number;
  mechanicalTotal: number;
  pendingBusiness: number;
  hasEntities: boolean;
}) {
  if (!hasEntities) return null;
  if (gatePassed) {
    return (
      <div className="border-b border-emerald-200 bg-emerald-50 px-5 py-2.5 text-[13px] font-medium text-emerald-900">
        实体审查通过 (需要你拍 {criticalReviewed}/{criticalTotal} 已审 · {mechanicalTotal} 个机械映射自动通过 · 0 待决策 question) — 可进入原型 tab
      </div>
    );
  }
  const stillToReview = criticalTotal - criticalReviewed;
  return (
    <div className="border-b border-slate-200 bg-slate-50 px-5 py-2 text-[12px] text-slate-700">
      立项审查进度: 已审 <span className="font-semibold text-slate-900">{criticalReviewed}</span> /{" "}
      {criticalTotal} 需要你拍
      {stillToReview > 0 ? <span> · 还需审 {stillToReview} 个</span> : null}
      {mechanicalTotal > 0 ? (
        <span className="text-slate-500"> · {mechanicalTotal} 个机械映射自动通过</span>
      ) : null}
      {pendingBusiness > 0 ? (
        <span> · 待决策 <span className="font-semibold text-amber-700">{pendingBusiness}</span> 个 question</span>
      ) : null}
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
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-5 py-2">
      <div className="text-[12px] text-slate-600">
        {entitiesData.exists ? (
          <>
            <span className="font-medium text-slate-900">{entitiesData.entities.length}</span> 个派生实体
            {entitiesData.generated_at ? (
              <span className="ml-2 text-slate-500">· 生成于 {formatTime(entitiesData.generated_at)}</span>
            ) : null}
          </>
        ) : (
          <span className="text-slate-500">尚无派生实体</span>
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

/* ============================================================
 *  实体卡片 · 决策者审阅视图
 * ============================================================ */
function EntityCard({
  entity,
  productId,
  readOnly,
  onChanged,
  pendingQuestionsCount: _pendingQuestionsCount,
  reason
}: {
  entity: DerivedEntity;
  productId: string;
  readOnly: boolean;
  onChanged: () => void;
  pendingQuestionsCount: number;
  reason?: string;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isNew = !entity.reviewedAt && isRecentlyDerived(entity.generated_at);
  const reviewed = Boolean(entity.reviewedAt);

  const toggleReview = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      const res = await fetch(
        `/api/products/${productId}/derived-entities/${encodeURIComponent(entity.name)}/review`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: reviewed ? "unmark" : "mark" })
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error ?? `HTTP ${res.status}`);
      }
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={`rounded-md border bg-white shadow-sm ${
        reviewed ? "border-emerald-200" : "border-slate-200"
      }`}
    >
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[14px] font-semibold text-slate-900">{entity.name}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
              {entity.layer}
            </span>
            {isNew ? (
              <span
                className="rounded border border-sky-300 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                title="7 天内派生, 尚未审"
              >
                <span style={{fontSize: "10px"}}>新</span>
              </span>
            ) : null}
            {reviewed ? (
              <span
                className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800"
                title={`审阅人: ${entity.reviewedBy ?? "unknown"} · ${entity.reviewedAt ?? ""}`}
              >
                已审
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            维护: {entity.maintainers} · features × {entity.sourceFeatures.length}
            {entity.sourceSeams.length > 0 ? ` · seams × ${entity.sourceSeams.length}` : ""}
            {entity.sourceDecisions.length > 0 ? ` · decisions × ${entity.sourceDecisions.length}` : ""}
          </div>
          {reason ? (
            <div className="mt-1 text-[10px] text-amber-700">为什么需要你拍: {reason}</div>
          ) : null}
        </div>
        {!readOnly ? (
          <button
            className={`shrink-0 rounded border px-2.5 py-1 text-[11px] font-medium disabled:opacity-50 ${
              reviewed
                ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                : "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
            }`}
            disabled={submitting}
            onClick={() => void toggleReview()}
            type="button"
          >
            {submitting ? "..." : reviewed ? "取消已审" : "标已审"}
          </button>
        ) : null}
      </header>

      {/* 决策者视角顶置色块 — 决策者审阅入口 */}
      {entity.decisionMakerView ? (
        <section className="border-b border-emerald-100 bg-emerald-50/40 px-4 py-3">
          <div className="text-[10px] font-medium text-emerald-800">给决策者</div>
          <div className="mt-1 text-[13px] leading-6 text-slate-800">
            <MarkdownRenderer markdown={entity.decisionMakerView} />
          </div>
        </section>
      ) : (
        <section className="border-b border-amber-200 bg-amber-50/40 px-4 py-2.5 text-[11px] italic text-amber-900">
          该实体缺 `## 给决策者` 段, 派生 agent 应在下轮重派生时补全(见契约 §3.3)。
        </section>
      )}

      {err ? (
        <div className="border-b border-rose-100 bg-rose-50 px-4 py-1.5 text-[11px] text-rose-700">
          {err}
        </div>
      ) : null}

      <button
        className="flex w-full items-center justify-between px-4 py-2 text-left text-[11px] text-slate-500 hover:bg-slate-50"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span>
          {open ? "▾ 收起" : "▸ 展开"} 完整 markdown(字段 / 状态机 / 权限 / 引用决策 / 引用接缝)
        </span>
        <span className="text-[10px] text-slate-400">
          {entity.generated_at ? formatTime(entity.generated_at) : ""}
        </span>
      </button>
      {open ? (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          <div className="prose prose-sm max-w-none">
            <MarkdownRenderer markdown={entity.body} />
          </div>
          {entity.sourceFeatures.length > 0 ? (
            <div className="mt-3 border-t border-slate-200 pt-2 text-[11px]">
              <div className="text-slate-500">来源 features:</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {entity.sourceFeatures.map((f) => (
                  <code key={f} className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                    {f}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ============================================================
 *  Reconcile section
 * ============================================================ */
function ReconcileSection({
  title,
  diffs,
  tone
}: {
  title: string;
  diffs: EntityReconcileReport["derivedOnly"];
  tone: "amber" | "slate" | "rose";
}) {
  const toneCls = {
    amber: "border-amber-200 bg-amber-50/40",
    slate: "border-slate-200 bg-slate-50",
    rose: "border-rose-200 bg-rose-50/40"
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-2 ${toneCls}`}>
      <div className="text-[12px] font-medium text-slate-900">
        {title}{" "}
        <span className="text-[10px] font-normal text-slate-500">({diffs.length})</span>
      </div>
      {diffs.length === 0 ? (
        <div className="mt-1 text-[11px] italic text-slate-400">—</div>
      ) : (
        <ul className="mt-1 space-y-1">
          {diffs.map((d, i) => (
            <li className="text-[11px] leading-5" key={i}>
              <span className="font-mono font-semibold text-slate-800">{d.name}</span>
              {d.declaredLayer ? <span className="ml-1 text-slate-500">·声明:{d.declaredLayer}</span> : null}
              {d.derivedLayer ? <span className="ml-1 text-slate-500">·派生:{d.derivedLayer}</span> : null}
              {d.derivedNote ? <span className="ml-1 text-slate-600">·{d.derivedNote}</span> : null}
              {d.suggestion ? <div className="text-slate-600">{d.suggestion}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
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
