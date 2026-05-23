import { useCallback, useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import type {
  ActorWithRefs,
  ApiEnvelope,
  CapabilityWithRefs,
  DerivedEntitiesData,
  DerivedEntityQuestionsData,
  GlobalFeedbackData,
  L0ViolationsData,
  ModuleWithFeatures,
  UseCase
} from "../types";

interface ReviewDashboardProps {
  productId: string;
}

interface DashboardData {
  actors: { total: number };
  capabilities: { total: number; confirmed: number; draft: number };
  usecases: { total: number };
  features: { total: number; reviewed: number; needsRevision: number; feedbackCount: number; missingCapability: number };
  entities: { total: number; reviewed: number; missingDecisionMakerView: number };
  questions: { total: number; pending: number; decided: number };
  globalFeedback: { feature: number; entity: number; prototype: number };
  l0: { violations: number; refIntegrityViolations: number; exists: boolean };
}

/**
 * 立项审查 dashboard — 一眼看完整个产品的审阅完整度, 不用切 tab。
 *
 * 信号源(全前端聚合, 后端不动):
 *   - features: modules-with-features → 累计 + reviewed_at + needs_revision + feedbackCount
 *   - entities: derived-entities → 累计 + reviewedAt + 缺 ## 给决策者 段
 *   - questions: derived-entities/questions → 累计 + pending vs decided
 *   - 全局需求池: global-feedback → 三段计数
 *   - L0 违规: l0-violations → 计数
 *
 * 立项 gate 算法:
 *   - feature gate: 0 个 needs_revision + features 数 > 0
 *   - entity gate: 0 个 pending question + 全部 entities 已审 + entities 数 > 0
 *   - L0 gate: 0 违规
 *   - 三者全 pass → 顶部绿色"立项审查通过"
 */
export function ReviewDashboard({ productId }: ReviewDashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [fRes, eRes, qRes, gRes, lRes, aRes, cRes, uRes] = await Promise.all([
        fetch(`/api/products/${productId}/modules-with-features`),
        fetch(`/api/products/${productId}/derived-entities`),
        fetch(`/api/products/${productId}/derived-entities/questions`),
        fetch(`/api/products/${productId}/global-feedback`),
        fetch(`/api/products/${productId}/l0-violations`),
        fetch(`/api/products/${productId}/actors`),
        fetch(`/api/products/${productId}/capabilities`),
        fetch(`/api/products/${productId}/usecases`)
      ]);
      if (!fRes.ok) throw new Error(`modules-with-features ${fRes.status}`);
      const fJson = (await fRes.json()) as ApiEnvelope<ModuleWithFeatures[]>;
      const eJson = eRes.ok ? ((await eRes.json()) as ApiEnvelope<DerivedEntitiesData>) : null;
      const qJson = qRes.ok ? ((await qRes.json()) as ApiEnvelope<DerivedEntityQuestionsData>) : null;
      const gJson = gRes.ok ? ((await gRes.json()) as ApiEnvelope<GlobalFeedbackData>) : null;
      const lJson = lRes.ok ? ((await lRes.json()) as ApiEnvelope<L0ViolationsData>) : null;
      const aJson = aRes.ok ? ((await aRes.json()) as ApiEnvelope<ActorWithRefs[]>) : null;
      const cJson = cRes.ok ? ((await cRes.json()) as ApiEnvelope<CapabilityWithRefs[]>) : null;
      const uJson = uRes.ok ? ((await uRes.json()) as ApiEnvelope<UseCase[]>) : null;

      const allFeatures = fJson.data.flatMap((m) => m.features);
      const features = {
        total: allFeatures.length,
        reviewed: allFeatures.filter((f) => f.reviewed_at).length,
        needsRevision: allFeatures.filter((f) => f.needs_revision).length,
        feedbackCount: allFeatures.reduce((s, f) => s + (f.feedbackCount ?? 0), 0),
        // FeaturePointPreview 不直接含 capability_id, 但全 features API 输出含 — 这里用 0 作占位, 实际由 l0 lint 覆盖检测
        missingCapability: 0
      };

      const entitiesArr = eJson?.data.entities ?? [];
      const entities = {
        total: entitiesArr.length,
        reviewed: entitiesArr.filter((e) => e.reviewedAt).length,
        missingDecisionMakerView: entitiesArr.filter((e) => !e.decisionMakerView.trim()).length
      };

      const qArr = qJson?.data.questions ?? [];
      const questions = {
        total: qArr.length,
        pending: qArr.filter((q) => q.status === "pending").length,
        decided: qArr.filter((q) => q.status !== "pending").length
      };

      const gd = gJson?.data ?? { feature: [], entity: [], prototype: [] };
      const globalFeedback = {
        feature: gd.feature.length,
        entity: gd.entity.length,
        prototype: gd.prototype.length
      };

      const refIntegrityViolations = (lJson?.data.violations ?? []).filter(
        (v) => v.category === "invalid-reference"
      ).length;
      const l0 = {
        violations: lJson?.data.violations.length ?? 0,
        refIntegrityViolations,
        exists: Boolean(lJson?.data.exists)
      };

      const actorList = aJson?.data ?? [];
      const capList = cJson?.data ?? [];
      const ucList = uJson?.data ?? [];

      const actors = { total: actorList.length };
      const capabilities = {
        total: capList.length,
        confirmed: capList.filter((c) => c.status === "confirmed").length,
        draft: capList.filter((c) => c.status === "draft").length
      };
      const usecases = { total: ucList.length };

      setData({ actors, capabilities, usecases, features, entities, questions, globalFeedback, l0 });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [productId]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  if (error) {
    return (
      <div className="border-b border-rose-200 bg-rose-50 px-6 py-1.5 text-[11px] text-rose-700">
        审查进度加载失败:{error}
      </div>
    );
  }
  if (!data) {
    return (
      <div className="border-b border-slate-200 bg-slate-50 px-6 py-1.5 text-[11px] text-slate-400">
        审查进度加载中...
      </div>
    );
  }

  const featureGate = data.features.total > 0 && data.features.needsRevision === 0;
  const entityGate =
    data.entities.total > 0 && data.entities.reviewed === data.entities.total && data.questions.pending === 0;
  const fiveSkeletonGate = data.actors.total > 0 && data.capabilities.total > 0; // 五层骨架存在
  const refIntegrityGate = data.l0.refIntegrityViolations === 0;
  const allPass = featureGate && entityGate && fiveSkeletonGate && refIntegrityGate;

  return (
    <div
      className={`border-b ${
        allPass ? "border-emerald-200 bg-emerald-50/80" : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-2 text-[12px]">
        {allPass ? (
          <span className="font-semibold text-emerald-900">立项审查通过 — 可进入开发</span>
        ) : (
          <span className="font-medium text-slate-700">立项审查进度</span>
        )}

        <DashItem
          label="Actor"
          primary={`${data.actors.total}`}
          tone={data.actors.total === 0 ? "warn" : "info"}
          hint={data.actors.total === 0 ? "未建 actor 池 (五层骨架不完整)" : null}
        />

        <DashItem
          label="Capability"
          primary={`${data.capabilities.confirmed}/${data.capabilities.total}`}
          tone={
            data.capabilities.total === 0
              ? "warn"
              : data.capabilities.confirmed === data.capabilities.total
                ? "ok"
                : "info"
          }
          hint={data.capabilities.draft > 0 ? `${data.capabilities.draft} 个 draft 待确认` : null}
        />

        <DashItem
          label="Function"
          primary={`${data.features.reviewed}/${data.features.total}`}
          tone={
            data.features.total === 0
              ? "muted"
              : data.features.needsRevision > 0
                ? "warn"
                : data.features.reviewed === data.features.total
                  ? "ok"
                  : "info"
          }
          hint={
            data.features.needsRevision > 0
              ? `${data.features.needsRevision} 个 ⚠ 待 agent 重做`
              : data.features.feedbackCount > 0
                ? `${data.features.feedbackCount} 条反馈`
                : null
          }
        />

        <DashItem
          label="UseCase"
          primary={`${data.usecases.total}`}
          tone={data.usecases.total === 0 ? "muted" : "info"}
          hint={null}
        />

        <DashItem
          label="实体"
          primary={`${data.entities.reviewed}/${data.entities.total}`}
          tone={
            data.entities.total === 0
              ? "muted"
              : data.entities.reviewed === data.entities.total
                ? "ok"
                : "info"
          }
          hint={
            data.entities.missingDecisionMakerView > 0
              ? `${data.entities.missingDecisionMakerView} 缺给决策者段`
              : null
          }
        />

        <DashItem
          label="待决策 question"
          primary={`${data.questions.pending}`}
          tone={data.questions.pending === 0 ? "muted" : "warn"}
          hint={data.questions.decided > 0 ? `已决策 ${data.questions.decided}` : null}
        />

        <DashItem
          label="全局需求池"
          primary={`${data.globalFeedback.feature + data.globalFeedback.entity + data.globalFeedback.prototype}`}
          tone={
            data.globalFeedback.feature + data.globalFeedback.entity + data.globalFeedback.prototype === 0
              ? "muted"
              : "info"
          }
          hint={
            `${data.globalFeedback.feature}·${data.globalFeedback.entity}·${data.globalFeedback.prototype} 功能·实体·原型`
          }
        />

        <DashItem
          label="L0 违规"
          primary={data.l0.exists ? `${data.l0.violations}` : "—"}
          tone={!data.l0.exists ? "muted" : data.l0.violations === 0 ? "ok" : "warn"}
          hint={
            data.l0.refIntegrityViolations > 0
              ? `引用残缺 ${data.l0.refIntegrityViolations}`
              : null
          }
        />
      </div>
    </div>
  );
}

function DashItem({
  label,
  primary,
  tone,
  hint
}: {
  label: string;
  primary: string;
  tone: "ok" | "warn" | "info" | "muted";
  hint: string | null;
}) {
  const toneCls = {
    ok: "text-emerald-800",
    warn: "text-amber-800",
    info: "text-slate-900",
    muted: "text-slate-400"
  }[tone];
  const dotCls = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    info: "bg-slate-500",
    muted: "bg-slate-300"
  }[tone];
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`h-1.5 w-1.5 self-center rounded-full ${dotCls}`} />
      <span className="text-slate-500">{label}</span>
      <span className={`font-mono font-semibold ${toneCls}`}>{primary}</span>
      {hint ? <span className="text-[10px] text-slate-500">· {hint}</span> : null}
    </div>
  );
}
