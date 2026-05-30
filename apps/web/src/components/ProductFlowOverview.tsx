import { useCallback, useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import type { TabKey } from "../lib/phaseTabs";
import type {
  ApiEnvelope,
  ActorWithRefs,
  DerivedEntitiesData,
  ScreenSummary
} from "../types";
import { AgentTaskTriggers } from "./AgentTaskTriggers";
import { FeatureTab } from "./tabs/FeatureTab";

interface ProductFlowOverviewProps {
  productId: string;
  readOnly?: boolean;
  onDrill: (tab: TabKey) => void;
}

/**
 * 「依赖流总览」落地页 — 用视觉表达数据依赖:
 *   入口① 功能与用例(markmap 真源) → 派生 角色/实体/关系矩阵 → 入口② 双轨设计(消费全部)
 * 复用现有 endpoint + FeatureTab(embedded markmap)+ AgentTaskTriggers;
 * 深度编辑走「查看完整 →」下钻到对应 tab(各 tab 行为不变)。
 */
export function ProductFlowOverview({ productId, readOnly = false, onDrill }: ProductFlowOverviewProps) {
  const [actors, setActors] = useState<ActorWithRefs[]>([]);
  const [actorPending, setActorPending] = useState(false);
  const [entities, setEntities] = useState<DerivedEntitiesData | null>(null);
  const [screens, setScreens] = useState<ScreenSummary[]>([]);

  const load = useCallback(async () => {
    try {
      const [aRes, eRes, sRes] = await Promise.all([
        fetch(`/api/products/${productId}/actors`),
        fetch(`/api/products/${productId}/derived-entities`),
        fetch(`/api/products/${productId}/screens`)
      ]);
      if (aRes.ok) {
        const aJson = (await aRes.json()) as ApiEnvelope<ActorWithRefs[]> & { pendingWork?: boolean };
        setActors(aJson.data);
        setActorPending(Boolean(aJson.pendingWork));
      }
      if (eRes.ok) {
        const eJson = (await eRes.json()) as ApiEnvelope<DerivedEntitiesData>;
        setEntities(eJson.data);
      }
      if (sRes.ok) {
        const sJson = (await sRes.json()) as ApiEnvelope<ScreenSummary[]>;
        setScreens(sJson.data);
      }
    } catch {
      /* 只读总览,失败时各卡显示占位 */
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChange(() => {
    void load();
  });

  const entityCount = entities?.entities.length ?? 0;
  const entityStale = entities ? entities.exists && entities.stale : false;
  const entityDisabled = Boolean(entities?.exists && !entities.stale);

  return (
    <div className="space-y-3 p-5">
      <div className="flex items-center justify-end">
        <button
          className="text-[11px] text-slate-500 hover:text-indigo-700"
          onClick={() => onDrill("overview")}
          type="button"
        >
          📄 概览 / 项目文档 →
        </button>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]">
        {/* ===== 左:入口① 真源 markmap + 派生层 ===== */}
        <div className="space-y-3">
          {/* 入口① 功能与用例 */}
          <FlowCard
            badge="入口 ①"
            badgeTone="source"
            title="功能与用例"
            subtitle="需求唯一真源 · 决策者确认入口"
            onDrill={() => onDrill("features")}
            actions={
              !readOnly ? (
                <AgentTaskTriggers
                  productId={productId}
                  triggers={[
                    { label: "更新功能与用例", kinds: ["feature-revise", "usecase-revise", "usecase-generate"] }
                  ]}
                />
              ) : null
            }
          >
            <div className="h-[440px] overflow-hidden rounded-md border border-slate-200 bg-slate-50">
              <FeatureTab productId={productId} readOnly={readOnly} embedded />
            </div>
          </FlowCard>

          {/* 派生层 */}
          <div className="flex items-center gap-2 pl-1 text-[11px] font-semibold text-violet-700">
            <span className="text-slate-400">↓</span> 从「功能与用例」派生
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <DeriveCard
              title="角色"
              icon="👤"
              count={actors.length}
              unit="个角色"
              onDrill={() => onDrill("actors")}
              trigger={
                !readOnly ? (
                  <AgentTaskTriggers
                    productId={productId}
                    triggers={[
                      {
                        label: "更新角色",
                        kinds: ["actor-revise"],
                        disabled: !actorPending,
                        disabledHint: "角色没有反馈池,只由全局需求池驱动;池中无 actor 相关条目时无需更新"
                      }
                    ]}
                  />
                ) : null
              }
            />
            <DeriveCard
              title="实体"
              icon="🧩"
              count={entityCount}
              unit="个实体"
              note={entityStale ? "派生已过期,可重派生" : undefined}
              onDrill={() => onDrill("entities")}
              trigger={
                !readOnly ? (
                  <AgentTaskTriggers
                    productId={productId}
                    triggers={[
                      {
                        label: "更新实体",
                        kinds: ["entity-derive", "entity-revise"],
                        disabled: entityDisabled,
                        disabledHint: "功能点等来源无更新,实体无需重派生"
                      }
                    ]}
                  />
                ) : null
              }
            />
            <DeriveCard
              title="关系矩阵"
              icon="🔗"
              count={null}
              unit=""
              auto="上游变更后自动重算"
              onDrill={() => onDrill("matrix")}
            >
              <MiniMatrix />
            </DeriveCard>
          </div>
        </div>

        {/* ===== 右:入口② 双轨设计(消费全部) ===== */}
        <FlowCard
          badge="入口 ②"
          badgeTone="sink"
          title="双轨设计"
          subtitle="消费全部上游信息 · 渲染界面规格 / 原型图"
          onDrill={() => onDrill("design")}
          actions={
            !readOnly ? (
              <AgentTaskTriggers
                productId={productId}
                triggers={[
                  { label: "生成界面规格", kinds: ["screen-generate"] },
                  { label: "更新界面规格", kinds: ["screen-revise"] }
                ]}
              />
            ) : null
          }
        >
          {screens.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-400">
              暂无界面屏。用上方「生成界面规格」让 agent 反推。
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {screens.slice(0, 6).map((s) => (
                <ScreenThumb key={`${s.module}/${s.id}`} productId={productId} screen={s} />
              ))}
            </div>
          )}
          {screens.length > 6 ? (
            <button
              className="mt-3 w-full rounded border border-slate-200 py-1.5 text-[11px] text-slate-500 hover:bg-slate-50"
              onClick={() => onDrill("design")}
              type="button"
            >
              查看全部 {screens.length} 个界面屏 →
            </button>
          ) : null}
        </FlowCard>
      </div>

      {/* ===== 底部:数据依赖说明 ===== */}
      <div className="flex items-start gap-2 rounded-md border border-indigo-100 bg-indigo-50/60 px-4 py-2.5 text-[12px] text-slate-600">
        <span className="font-semibold text-indigo-700">数据依赖说明</span>
        <span>
          功能与用例是唯一真源,变更会自动传递并重算下游(角色 / 实体 / 关系矩阵),双轨设计消费全部信息生成界面规格。
        </span>
      </div>
    </div>
  );
}

/* ---------- 入口卡(① / ②)外壳 ---------- */
function FlowCard({
  badge,
  badgeTone,
  title,
  subtitle,
  actions,
  onDrill,
  children
}: {
  badge: string;
  badgeTone: "source" | "sink";
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  onDrill: () => void;
  children: React.ReactNode;
}) {
  const tone =
    badgeTone === "source"
      ? "border-indigo-200 bg-white"
      : "border-slate-300 bg-white";
  const badgeCls =
    badgeTone === "source"
      ? "bg-indigo-600 text-white"
      : "bg-slate-900 text-white";
  return (
    <section className={`rounded-xl border ${tone} shadow-sm`}>
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${badgeCls}`}>{badge}</span>
            <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
            <button
              className="text-[11px] text-indigo-600 hover:underline"
              onClick={onDrill}
              type="button"
            >
              查看完整 →
            </button>
          </div>
          <div className="mt-1 text-[11.5px] text-slate-500">{subtitle}</div>
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

/* ---------- 派生卡 ---------- */
function DeriveCard({
  title,
  icon,
  count,
  unit,
  note,
  auto,
  trigger,
  onDrill,
  children
}: {
  title: string;
  icon: string;
  count: number | null;
  unit: string;
  note?: string;
  auto?: string;
  trigger?: React.ReactNode;
  onDrill: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-violet-200 bg-violet-50/40 p-3">
      <button
        className="flex items-center gap-1.5 text-left text-[13.5px] font-semibold text-slate-900 hover:text-indigo-700"
        onClick={onDrill}
        type="button"
        title="查看完整"
      >
        <span>{icon}</span>
        {title}
        <span className="text-[11px] font-normal text-slate-400">→</span>
      </button>
      {count !== null ? (
        <div className="mt-1 text-[12px] text-slate-600">
          <span className="font-semibold text-slate-800">{count}</span> {unit}
        </div>
      ) : null}
      {note ? <div className="mt-1 text-[11px] text-amber-700">{note}</div> : null}
      {auto ? (
        <div className="mt-1 inline-block self-start rounded border border-dashed border-violet-300 bg-white px-1.5 py-0.5 text-[10px] text-violet-700">
          ⚡ {auto}
        </div>
      ) : null}
      {children ? <div className="mt-2">{children}</div> : null}
      {trigger ? <div className="mt-2">{trigger}</div> : null}
    </div>
  );
}

/* ---------- 关系矩阵 mini(装饰性热力,真矩阵在 matrix tab) ---------- */
function MiniMatrix() {
  const cells = Array.from({ length: 25 }, (_, i) => (i * 7) % 5);
  return (
    <div className="grid w-fit grid-cols-5 gap-0.5">
      {cells.map((v, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-[2px]"
          style={{ background: ["#ede9fe", "#ddd6fe", "#c4b5fd", "#a78bfa", "#8b5cf6"][v] }}
        />
      ))}
    </div>
  );
}

/* ---------- 双轨屏幕缩略(best-effort,无图占位) ---------- */
function ScreenThumb({ productId, screen }: { productId: string; screen: ScreenSummary }) {
  const [ok, setOk] = useState(true);
  const src = `/api/products/${productId}/screens/${screen.module}/${screen.id}/preview-image`;
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex h-[96px] items-center justify-center bg-slate-50">
        {ok ? (
          // eslint-disable-next-line jsx-a11y/img-redundant-alt
          <img
            alt={screen.name}
            className="h-full w-full object-cover object-top"
            onError={() => setOk(false)}
            src={src}
          />
        ) : (
          <span className="text-[10px] text-slate-400">待出图</span>
        )}
      </div>
      <div className="truncate px-2 py-1 text-center text-[11px] text-slate-600" title={screen.name}>
        {screen.name}
      </div>
    </div>
  );
}
