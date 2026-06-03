import { useCallback, useEffect, useState } from "react";
import { useDataChange } from "../lib/useDataChange";
import { SessionTreePanel } from "./SessionTreePanel";
import { DevInstructBox } from "./DevInstructBox";

/**
 * 开发驾驶舱(决策者视角)。把"进开发后该做什么"收口成:
 * ① 码仓/脚手架状态 + 一键搭骨架  ② 等你拍板(业务决策)banner
 * ③ 建造看板(逐模块开建,起 code Session) ④ 折叠的编排树 + 高级自由提需求。
 */

interface DevStatus {
  repo: { configured: boolean; repoDir: string; cloned: boolean; scaffolded: boolean };
  modules: { name: string; title: string; featureCount: number }[];
}

export function DevCockpit({ productId }: { productId: string }) {
  const [status, setStatus] = useState<DevStatus | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [kicked, setKicked] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/products/${productId}/dev/status`);
      if (r.ok) setStatus(((await r.json()) as { data: DevStatus }).data);
    } catch {
      /* ignore */
    }
    try {
      const r2 = await fetch(`/api/products/${productId}/derived-entities/questions`);
      if (r2.ok) {
        const j = (await r2.json()) as unknown;
        const arr = Array.isArray(j) ? j : (j as { data?: unknown[] }).data ?? [];
        setPending((arr as { status?: string }[]).filter((q) => q?.status === "pending").length);
      }
    } catch {
      /* ignore */
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);
  useDataChange(() => void load());

  const scaffold = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`/api/products/${productId}/dev/scaffold`, { method: "POST" });
      if (!r.ok) {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg(b.error ?? `搭骨架失败: ${r.status}`);
      } else {
        setMsg("🏗 已开始搭骨架 — 见下方「需求编排树」,跑完进待审,你审核后落地。");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buildModule = async (m: { name: string; title: string }) => {
    setMsg(null);
    const instruction =
      `建造「${m.title}」(${m.name})模块的应用代码:按本仓既有工程骨架与约定,` +
      `在该模块目录下实现其功能(参考规格里该模块的功能点/实体/用例)。最小可用、能跑通、与既有风格一致。`;
    try {
      const r = await fetch(`/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, kind: "code-instruct", instruction })
      });
      if (r.ok) {
        setKicked((b) => ({ ...b, [m.name]: true }));
        setMsg(`▶ 已开建「${m.title}」 — 见下方「需求编排树」。`);
      } else {
        const b = (await r.json().catch(() => ({}))) as { error?: string };
        setMsg(b.error ?? `开建失败: ${r.status}`);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  if (!status) return null;
  const { repo, modules } = status;

  return (
    <section className="border-b border-slate-200 bg-white px-6 py-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-950">🛠 开发驾驶舱</h2>
        <span className="text-[11px] text-slate-500">从立项规格 → 应用代码:先搭骨架,再逐模块开建,产出进待审</span>
      </div>

      {/* ① 码仓 / 脚手架状态 */}
      {!repo.configured ? (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          未接代码仓 —— 配置任一即可:<code>~/.atlas/products/{productId}/repo</code>(一行 git URL)/ 环境变量{" "}
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
          ✅ 代码工程已初始化 —— 可以逐模块开建了。
        </div>
      )}

      {/* ② 等你拍板 */}
      {pending > 0 ? (
        <div className="mb-3 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-[12px] text-indigo-800">
          ⚠ <span className="font-semibold">等你拍板 {pending} 项</span>业务决策 —— 去「实体」tab 的「待决策 question」逐条接受/自定义/驳回。
        </div>
      ) : null}

      {/* ③ 建造看板 */}
      <div className="mb-1 text-[11px] font-medium text-slate-500">建造看板 · 按模块</div>
      {repo.scaffolded ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {modules.map((m) => (
            <div key={m.name} className="rounded-md border border-slate-200 bg-slate-50 p-2.5">
              <div className="truncate text-[13px] font-medium text-slate-900" title={m.title}>
                {m.title}
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400">{m.featureCount} 功能点</div>
              <button
                className="mt-2 w-full rounded bg-indigo-600 px-2 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-700 disabled:opacity-50"
                disabled={kicked[m.name]}
                onClick={() => void buildModule(m)}
                type="button"
              >
                {kicked[m.name] ? "已开建 ↓" : "▶ 开建"}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-slate-300 px-3 py-3 text-[12px] text-slate-400">
          先搭骨架,再逐模块开建。
        </div>
      )}

      {msg ? <p className="mt-2 text-[12px] text-slate-600">{msg}</p> : null}

      {/* ④ 编排树(引擎仪表盘)+ 高级自由提需求 */}
      <div className="mt-4">
        <SessionTreePanel productId={productId} />
      </div>
      <div className="mt-3">
        <button
          className="text-[11px] text-slate-500 underline hover:text-slate-700"
          onClick={() => setShowAdvanced((v) => !v)}
          type="button"
        >
          {showAdvanced ? "收起" : "高级:自由提需求(改规格 / 改代码)"}
        </button>
        {showAdvanced ? (
          <div className="mt-2">
            <DevInstructBox productId={productId} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
