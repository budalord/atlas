import { useCallback, useEffect, useMemo, useState } from "react";
import { useDataChange } from "../../lib/useDataChange";
import type {
  ActorType,
  ActorWithRefs,
  ApiEnvelope,
  CapabilityWithRefs,
  EntitySpec,
  ModuleWithFeatures,
  UseCase
} from "../../types";
import { MarkdownRenderer } from "../MarkdownRenderer";
import { AgentTaskTriggers } from "../AgentTaskTriggers";

interface ActorTabProps {
  productId: string;
  readOnly?: boolean;
}

const TYPE_LABELS: Record<ActorType, string> = {
  internal_user: "内部用户",
  external_user: "外部用户",
  external_system: "外部系统"
};

const TYPE_COLORS: Record<ActorType, { border: string; bg: string; text: string }> = {
  internal_user: { border: "border-emerald-300", bg: "bg-emerald-50/60", text: "text-emerald-800" },
  external_user: { border: "border-sky-300", bg: "bg-sky-50/60", text: "text-sky-800" },
  external_system: { border: "border-violet-300", bg: "bg-violet-50/60", text: "text-violet-800" }
};

/**
 * Actor tab (v0.1 rev3 五层骨架的 Actor 视图)。
 *
 * 显示项目级 actor 列表(按 type 分组卡片)+ 选中详情面板:
 *   - 基本信息: type / responsibilities / body
 *   - 关联 capability (反向投影 from actor.related_capability_ids)
 *   - 操作 entity (推导: 取 actor 所在 capabilities 的 entity_ids 并集)
 *   - 关联 usecase (反向投影)
 *
 * 数据源全前端聚合, 无新 endpoint。
 */
export function ActorTab({ productId, readOnly = false }: ActorTabProps) {
  const [actors, setActors] = useState<ActorWithRefs[]>([]);
  const [capabilities, setCapabilities] = useState<CapabilityWithRefs[]>([]);
  const [entities, setEntities] = useState<EntitySpec[]>([]);
  const [usecases, setUsecases] = useState<UseCase[]>([]);
  const [modules, setModules] = useState<ModuleWithFeatures[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actorWorkPending, setActorWorkPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const [aRes, cRes, eRes, uRes, mRes] = await Promise.all([
        fetch(`/api/products/${productId}/actors`),
        fetch(`/api/products/${productId}/capabilities`),
        fetch(`/api/products/${productId}/entities`),
        fetch(`/api/products/${productId}/usecases`),
        fetch(`/api/products/${productId}/modules-with-features`)
      ]);
      if (!aRes.ok) throw new Error(`actors ${aRes.status}`);
      const aJson = (await aRes.json()) as ApiEnvelope<ActorWithRefs[]>;
      const cJson = cRes.ok ? ((await cRes.json()) as ApiEnvelope<CapabilityWithRefs[]>) : null;
      const eJson = eRes.ok ? ((await eRes.json()) as ApiEnvelope<EntitySpec[]>) : null;
      const uJson = uRes.ok ? ((await uRes.json()) as ApiEnvelope<UseCase[]>) : null;
      const mJson = mRes.ok ? ((await mRes.json()) as ApiEnvelope<ModuleWithFeatures[]>) : null;
      setActors(aJson.data);
      setActorWorkPending(Boolean((aJson as { pendingWork?: boolean }).pendingWork));
      setCapabilities(cJson?.data ?? []);
      setEntities(eJson?.data ?? []);
      setUsecases(uJson?.data ?? []);
      setModules(mJson?.data ?? []);
      setError(null);
      if (selectedId === null && aJson.data.length > 0) {
        setSelectedId(aJson.data[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    setSelectedId(null);
    void load();
  }, [load]);

  useDataChange(() => {
    void load();
  });

  const grouped = useMemo(() => {
    const g: Record<ActorType, ActorWithRefs[]> = {
      internal_user: [],
      external_user: [],
      external_system: []
    };
    for (const a of actors) g[a.type].push(a);
    return g;
  }, [actors]);

  const current = useMemo(
    () => actors.find((a) => a.id === selectedId) ?? null,
    [actors, selectedId]
  );

  // 推导 current actor 操作的 entities: 取关联 capabilities 的 entity_ids 并集 + 关联 functions 的 entities_touched 并集
  const currentEntities = useMemo(() => {
    if (!current) return [] as { id: string; via: string[] }[];
    const map = new Map<string, Set<string>>();
    for (const capId of current.related_capability_ids) {
      const cap = capabilities.find((c) => c.id === capId);
      if (!cap) continue;
      for (const eid of cap.entity_ids) {
        if (!map.has(eid)) map.set(eid, new Set());
        map.get(eid)!.add(`capability:${capId}`);
      }
    }
    const allFunctions = modules.flatMap((m) => m.features);
    for (const fid of current.related_function_ids) {
      const fn = allFunctions.find((f) => f.id === fid);
      if (!fn?.entities_touched) continue;
      for (const eid of fn.entities_touched) {
        if (!map.has(eid)) map.set(eid, new Set());
        map.get(eid)!.add(`function:${fid}`);
      }
    }
    return Array.from(map.entries())
      .map(([id, via]) => ({ id, via: Array.from(via) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [current, capabilities, modules]);

  if (error) return <div className="p-5 text-sm text-rose-700">{error}</div>;
  if (actors.length === 0) {
    return (
      <div className="m-5 rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-[13px] leading-6 text-slate-600">
        <div className="text-[14px] font-medium text-slate-900">尚未建立 Actor 池</div>
        <div className="mt-1 text-slate-500">
          {"v0.1 rev3 五层骨架要求项目级 Actor 池(actors/<id>.md)。"}
          <br />
          先在 yunkai-erp / example-training-erp 等已有产品中查看, 或 POST /actors 创建。
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {!readOnly ? (
        <div className="flex items-center justify-end border-b border-slate-200 bg-slate-50 px-5 py-1.5">
          <AgentTaskTriggers
            productId={productId}
            triggers={[
              {
                label: "更新角色",
                kinds: ["actor-revise"],
                disabled: !actorWorkPending,
                disabledHint:
                  "角色没有反馈池,只由全局需求池驱动;池中无 actor 相关条目时无需更新"
              }
            ]}
          />
        </div>
      ) : null}
      <div className="flex items-start">{/* master-detail: 左 list flow + 右 detail sticky-top */}
        <aside className="w-[320px] shrink-0 border-r border-slate-200 bg-white">
        {(Object.keys(grouped) as ActorType[]).map((t) => {
          const list = grouped[t];
          if (list.length === 0) return null;
          return (
            <div key={t}>
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-[11px] font-medium text-slate-500">
                {TYPE_LABELS[t]} ({list.length})
              </div>
              {list.map((a) => (
                <button
                  key={a.id}
                  className={`block w-full border-b border-slate-100 px-4 py-2 text-left text-sm ${
                    selectedId === a.id ? "bg-slate-900 text-white" : "hover:bg-slate-50"
                  }`}
                  onClick={() => setSelectedId(a.id)}
                  type="button"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.name}</span>
                    <span className={`text-[10px] ${selectedId === a.id ? "text-slate-300" : "text-slate-400"}`}>
                      cap:{a.related_capability_ids.length} · fn:{a.related_function_ids.length}
                    </span>
                  </div>
                  <div
                    className={`mt-0.5 truncate text-[11px] ${
                      selectedId === a.id ? "text-slate-300" : "text-slate-500"
                    }`}
                  >
                    {a.responsibilities ?? "(无职责描述)"}
                  </div>
                </button>
              ))}
            </div>
          );
        })}
      </aside>

      <div className="sticky top-0 max-h-screen flex-1 self-start overflow-y-auto">
        {current ? (
          <ActorDetail
            actor={current}
            capabilities={capabilities}
            entities={entities}
            usecases={usecases}
            currentEntities={currentEntities}
          />
        ) : (
          <div className="p-5 text-sm text-slate-500">选择左侧 actor 查看详情。</div>
        )}
      </div>
      </div>
    </div>
  );
}

function ActorDetail({
  actor,
  capabilities,
  entities,
  usecases,
  currentEntities
}: {
  actor: ActorWithRefs;
  capabilities: CapabilityWithRefs[];
  entities: EntitySpec[];
  usecases: UseCase[];
  currentEntities: { id: string; via: string[] }[];
}) {
  const tone = TYPE_COLORS[actor.type];
  return (
    <div className="space-y-5 p-5">
      <header className={`rounded-md border ${tone.border} ${tone.bg} px-4 py-3`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-[10px] font-medium ${tone.text}`}>
              {TYPE_LABELS[actor.type]}
              {actor.code ? ` · ${actor.code}` : ""}
            </div>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">{actor.name}</h2>
            <code className="mt-0.5 text-[11px] text-slate-500">{actor.id}</code>
          </div>
          <div className="flex items-center gap-2">
            {actor.confirmed ? (
              <span className="rounded border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                ✓ confirmed
              </span>
            ) : (
              <span className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-800">
                draft
              </span>
            )}
          </div>
        </div>
        {actor.responsibilities ? (
          <div className="mt-2 text-[12px] leading-6 text-slate-700">{actor.responsibilities}</div>
        ) : null}
      </header>

      {actor.body.trim() ? (
        <section className="rounded-md border border-slate-200 bg-white px-4 py-3">
          <div className="text-[10px] font-medium text-slate-500">业务描述</div>
          <div className="mt-1 prose prose-sm max-w-none">
            <MarkdownRenderer markdown={actor.body} />
          </div>
        </section>
      ) : null}

      {/* 关联 capability */}
      <section className="rounded-md border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
          关联 capability{" "}
          <span className="text-[11px] font-normal text-slate-500">
            ({actor.related_capability_ids.length})
          </span>
        </header>
        <div className="px-4 py-3">
          {actor.related_capability_ids.length === 0 ? (
            <div className="text-[11px] italic text-slate-400">
              该 actor 未关联任何 capability — 检查是否漏写 capability.actor_ids
            </div>
          ) : (
            <ul className="space-y-1.5">
              {actor.related_capability_ids.map((cid) => {
                const cap = capabilities.find((c) => c.id === cid);
                return (
                  <li key={cid} className="flex items-center gap-2 text-[12px]">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${
                        cap?.priority === "P0"
                          ? "bg-rose-50 text-rose-700"
                          : cap?.priority === "P1"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {cap?.priority ?? "?"}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">{cid}</span>
                    {cap ? <span className="text-slate-900">{cap.name}</span> : null}
                    {cap ? <span className="text-[10px] text-slate-400">· {cap.domain}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 操作 entity */}
      <section className="rounded-md border border-slate-200 bg-white">
        <header className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
          操作 entity{" "}
          <span className="text-[11px] font-normal text-slate-500">({currentEntities.length})</span>
        </header>
        <div className="px-4 py-3">
          {currentEntities.length === 0 ? (
            <div className="text-[11px] italic text-slate-400">—</div>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {currentEntities.map((e) => {
                const ent = entities.find((x) => x.name === e.id);
                return (
                  <li key={e.id} className="flex items-center gap-2 text-[12px]">
                    <code className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] text-indigo-700">
                      {e.id}
                    </code>
                    {ent ? null : (
                      <span className="text-[10px] text-amber-700" title="实体未派生">
                        未派生
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">via {e.via.length} 处</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* 关联 usecase */}
      {actor.related_usecase_ids.length > 0 ? (
        <section className="rounded-md border border-slate-200 bg-white">
          <header className="border-b border-slate-200 px-4 py-2 text-sm font-semibold text-slate-900">
            关联 usecase{" "}
            <span className="text-[11px] font-normal text-slate-500">
              ({actor.related_usecase_ids.length})
            </span>
          </header>
          <div className="px-4 py-3">
            <ul className="space-y-1.5">
              {actor.related_usecase_ids.map((u) => {
                const uc = usecases.find(
                  (x) => x.function_id === u.function_id && x.id === u.usecase_id
                );
                return (
                  <li
                    key={`${u.function_id}/${u.usecase_id}`}
                    className="flex items-center gap-2 text-[12px]"
                  >
                    <code className="text-[10px] text-slate-500">{u.function_id}</code>
                    <span className="text-slate-300">/</span>
                    <code className="font-mono text-[11px] text-slate-800">{u.usecase_id}</code>
                    {uc?.precondition ? (
                      <span className="ml-2 truncate text-[11px] text-slate-500">
                        前置: {uc.precondition}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : null}
    </div>
  );
}
