import { useCallback, useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import { SessionTreePanel } from "./SessionTreePanel";
import { DevInstructBox } from "./DevInstructBox";
import { ReviewChangesetModal } from "./ReviewChangesetModal";
import type { AgentSessionTree, ModuleWithFeatures, FeaturePointPreview, Screen, Task } from "../types";

/**
 * 开发驾驶舱(决策者视角)。
 * ① 码仓/脚手架状态 + 一键搭骨架
 * ② 等你拍板 banner
 * ③ 建造看板:模块(可折叠)→ 功能点卡片(建造+审核单元,状态联动);模块组头带原型页锚
 * ④ 折叠的编排树 + 高级自由提需求
 *
 * 建造单元 = 功能点。开建时给指令打 [feat:模块/id] 标签,卡片据此回连 build session 的真实状态。
 */

interface RepoStatus {
  configured: boolean;
  repoDir: string;
  cloned: boolean;
  scaffolded: boolean;
}

type FeatState = "none" | "building" | "review" | "done";

export function DevCockpit({ productId }: { productId: string }) {
  const [repo, setRepo] = useState<RepoStatus | null>(null);
  const [mods, setMods] = useState<ModuleWithFeatures[]>([]);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [sessions, setSessions] = useState<AgentSessionTree[]>([]);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reviewTask, setReviewTask] = useState<Task | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = useCallback(async () => {
    const get = async (url: string) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        return (await r.json()) as { data: unknown };
      } catch {
        return null;
      }
    };
    const [st, mf, sc, ss, q] = await Promise.all([
      get(`/api/products/${productId}/dev/status`),
      get(`/api/products/${productId}/modules-with-features`),
      get(`/api/products/${productId}/screens`),
      get(`/api/products/${productId}/sessions`),
      get(`/api/products/${productId}/derived-entities/questions`)
    ]);
    if (st) setRepo((st.data as { repo: RepoStatus }).repo);
    if (mf) setMods(mf.data as ModuleWithFeatures[]);
    if (sc) setScreens(sc.data as Screen[]);
    if (ss) setSessions(ss.data as AgentSessionTree[]);
    if (q) {
      const arr = (Array.isArray(q.data) ? q.data : []) as { status?: string }[];
      setPending(arr.filter((x) => x?.status === "pending").length);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChange(() => void load());

  // 同步打开中的审核 task 最新态(approve/reject 后 stage 变,模态自动切只读/关闭)
  useEffect(() => {
    if (!reviewTask) return;
    const fresh = sessions.flatMap((t) => t.tasks).find((t) => t.id === reviewTask.id);
    if (!fresh) {
      setReviewTask(null);
      return;
    }
    if (fresh.stage !== reviewTask.stage) setReviewTask(fresh as Task);
  }, [sessions, reviewTask]);

  const featTag = (f: FeaturePointPreview) => `[feat:${f.module}/${f.id}]`;

  const featInfo = (f: FeaturePointPreview): { state: FeatState; task?: Task } => {
    const tag = featTag(f);
    const matched = sessions.filter((t) => t.session.instruction.includes(tag));
    if (matched.length === 0) return { state: "none" };
    const tasks = matched.flatMap((t) => t.tasks);
    const review = tasks.find((x) => x.stage === "awaiting_review");
    if (review) return { state: "review", task: review as Task };
    const active = tasks.some((x) => x.stage === "queued" || x.stage === "running");
    // 刚开建、规划器还没拆出 Task 的窗口期也算"建造中",避免卡片看着像没动
    const planning = matched.some((t) => t.tasks.length === 0 && t.session.state !== "failed");
    if (active || planning) return { state: "building" };
    if (tasks.some((x) => x.stage === "completed")) return { state: "done" };
    return { state: "none" }; // 全 rejected/failed → 可再建
  };

  const screensOf = (moduleName: string) => screens.filter((s) => s.module === moduleName && s.preview_image);
  const screenImg = (s: Screen) =>
    `/api/products/${productId}/screens/${s.module}/${s.id}/preview-image?v=${encodeURIComponent(s.preview_image ?? "")}`;

  const scaffold = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/products/${productId}/dev/scaffold`, { method: "POST" });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg(b.error ?? `搭骨架失败: ${r.status}`);
      } else {
        setMsg("🏗 已开始搭骨架 — 见下方「全部编排」,跑完进待审,你审核后落地。");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buildFeature = async (mod: ModuleWithFeatures, f: FeaturePointPreview) => {
    setMsg(null);
    const modTitle = mod.module.title || mod.module.name;
    const instruction =
      `实现功能点「${f.name}」(模块 ${modTitle})。参照规格里该功能点(${f.id})及其对应原型页/实体/用例,` +
      `在本仓既有工程骨架内实现:最小可用、能跑通、与既有风格一致。 ${featTag(f)}`;
    try {
      const r = await fetch(`/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, kind: "code-instruct", instruction })
      });
      if (r.ok) setMsg(`▶ 已开建功能点「${f.name}」。`);
      else {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg(b.error ?? `开建失败: ${r.status}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  if (!repo) return null;

  return (
    <section className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">🛠 开发驾驶舱</h2>
        <span className="text-[11px] text-slate-500">立项规格 → 应用代码:先搭骨架,再逐功能点建造,产出进待审</span>
      </div>

      {/* ① 码仓 / 脚手架状态 */}
      {!repo.configured ? (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          未接代码仓 —— 配置任一:<code>~/.atlas/products/{productId}/repo</code>(一行 git URL)/ 环境变量{" "}
          <code>ATLAS_REPO_{productId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}</code> / meta.yml 的 repo。
        </div>
      ) : !repo.scaffolded ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
          <div className="text-[12px] text-amber-800">
            <span className="font-semibold">代码工程尚未初始化</span> —— 仓里目前只有规格,还没有可运行的工程骨架。第一步先搭地基。
          </div>
          <button
            className="shrink-0 rounded-md bg-slate-950 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy}
            onClick={() => void scaffold()}
            type="button"
          >
            {busy ? "启动中…" : "🏗 一键搭骨架"}
          </button>
        </div>
      ) : (
        <div className="mb-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-800">
          ✅ 代码工程已初始化 —— 展开模块,逐功能点建造。
        </div>
      )}

      {/* ② 等你拍板 */}
      {pending > 0 ? (
        <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] text-indigo-800">
          ⚠ <span className="font-semibold">等你拍板 {pending} 项</span>业务决策 —— 去「实体」tab 的「待决策 question」逐条接受/自定义/驳回。
        </div>
      ) : null}

      {/* ③ 建造看板:模块 → 功能点(未搭骨架也展示蓝图,开建按钮锁住) */}
      <div className="mb-1 text-[11px] font-medium text-slate-500">建造看板 · 模块 → 功能点(建造/审核单元)</div>
      {mods.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-[12px] text-slate-400">该产品暂无模块/功能点。</div>
      ) : (
        <div className="space-y-2">
          {!repo.scaffolded ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800">
              下面是你 ERP 的蓝图:<b>{mods.length} 个模块 · {mods.reduce((n, m) => n + m.features.length, 0)} 个功能点 · {screens.length} 张原型页</b>(规格一个没少)。先「一键搭骨架」,再逐个开建。
            </div>
          ) : null}
          {mods.map((mod) => {
            const feats = mod.features;
            const open = expanded[mod.module.name] ?? false;
            const done = feats.filter((f) => featInfo(f).state === "done").length;
            const building = feats.filter((f) => {
              const s = featInfo(f).state;
              return s === "building" || s === "review";
            }).length;
            const modScreens = screensOf(mod.module.name);
            return (
              <div key={mod.module.name} className="rounded-md border border-slate-200">
                <button
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => setExpanded((e) => ({ ...e, [mod.module.name]: !open }))}
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">{open ? "▾" : "▸"}</span>
                    <span className="text-[13px] font-medium text-slate-900">{mod.module.title || mod.module.name}</span>
                    <span className="text-[10px] text-slate-400">{feats.length} 功能点 · {modScreens.length} 原型页</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px]">
                    {building > 0 ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">{building} 进行/待审</span> : null}
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">{done}/{feats.length} 已落地</span>
                  </span>
                </button>

                {open ? (
                  <div className="border-t border-slate-100 px-3 py-2.5">
                    {/* 原型页锚:本模块原型页缩略图条 */}
                    {modScreens.length > 0 ? (
                      <div className="mb-2.5">
                        <div className="mb-1 text-[10px] text-slate-400">原型页(点开看大图,作为建造/验收参照)</div>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {modScreens.map((s) => (
                            <button
                              className="shrink-0 rounded border border-slate-200 hover:border-indigo-400"
                              key={s.id}
                              onClick={() => setLightbox(screenImg(s))}
                              title={s.name}
                              type="button"
                            >
                              <img alt={s.name} className="h-16 w-28 rounded object-cover object-top" src={screenImg(s)} />
                              <div className="max-w-28 truncate px-1 py-0.5 text-[9px] text-slate-500">{s.name}</div>
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {/* 功能点卡片 */}
                    <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2 lg:grid-cols-3">
                      {feats.map((f) => {
                        const info = featInfo(f);
                        return (
                          <div key={f.id} className="rounded border border-slate-200 bg-slate-50 p-2">
                            <div className="flex items-start justify-between gap-1.5">
                              <span className="text-[12px] font-medium text-slate-900" title={f.name}>{f.name}</span>
                              <FeatBadge state={info.state} />
                            </div>
                            <div className="mt-1.5">
                              {info.state === "review" && info.task ? (
                                <button
                                  className="w-full rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-indigo-700"
                                  onClick={() => setReviewTask(info.task!)}
                                  type="button"
                                >
                                  审核
                                </button>
                              ) : info.state === "building" ? (
                                <div className="w-full rounded bg-amber-50 px-2 py-1 text-center text-[11px] text-amber-700">建造中…</div>
                              ) : info.state === "done" ? (
                                <button
                                  className="w-full rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-500 hover:bg-white"
                                  onClick={() => void buildFeature(mod, f)}
                                  type="button"
                                >
                                  ↻ 再建/改
                                </button>
                              ) : repo.scaffolded ? (
                                <button
                                  className="w-full rounded bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-700"
                                  onClick={() => void buildFeature(mod, f)}
                                  type="button"
                                >
                                  ▶ 开建
                                </button>
                              ) : (
                                <button
                                  className="w-full cursor-not-allowed rounded bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-400"
                                  disabled
                                  title="先「一键搭骨架」后才能开建"
                                  type="button"
                                >
                                  🔒 先搭骨架
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {msg ? <p className="mt-2 text-[12px] text-slate-600">{msg}</p> : null}

      {/* ④ 全部编排明细(折叠)+ 高级自由提需求 */}
      <details className="mt-4">
        <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-700">全部编排明细(引擎仪表盘)</summary>
        <div className="mt-2">
          <SessionTreePanel productId={productId} />
        </div>
      </details>
      <div className="mt-2">
        <button className="text-[11px] text-slate-500 underline hover:text-slate-700" onClick={() => setShowAdvanced((v) => !v)} type="button">
          {showAdvanced ? "收起" : "高级:自由提需求(改规格 / 改代码)"}
        </button>
        {showAdvanced ? <div className="mt-2"><DevInstructBox productId={productId} /></div> : null}
      </div>

      {/* 卡片触发的审核弹窗 */}
      {reviewTask ? <ReviewChangesetModal onClose={() => setReviewTask(null)} task={reviewTask} /> : null}

      {/* 原型页大图 lightbox */}
      {lightbox ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setLightbox(null)}>
          <img alt="原型页" className="max-h-full max-w-full rounded shadow-2xl" src={lightbox} />
        </div>
      ) : null}
    </section>
  );
}

function FeatBadge({ state }: { state: FeatState }) {
  const cfg: Record<FeatState, { cls: string; label: string }> = {
    none: { cls: "bg-slate-100 text-slate-500", label: "未建" },
    building: { cls: "bg-amber-100 text-amber-800", label: "建造中" },
    review: { cls: "bg-indigo-100 text-indigo-800", label: "待审" },
    done: { cls: "bg-emerald-100 text-emerald-800", label: "已落地" }
  };
  const c = cfg[state];
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium ${c.cls}`}>{c.label}</span>;
}
