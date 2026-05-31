/**
 * 屏渲染收口(后端)。把 CLI 的 render-and-submit 接成产品内的服务:
 *   壳(IA.json 真源组装)+ 内容区 → headless Chrome → PNG → 喂现有三态闸(submitPrototype)。
 *
 * 这是"待渲染队列(needs_prototype)"缺的那个**消费者**:此前队列只有 codex drain 客户端会抽,
 * codex 砍掉后没人接 → 屏卡在待渲染。本服务由 Atlas 后端充当消费者, UI 一键即可抽干。
 *
 * 内容区: 已手搓的用手搓的; 没有的从真源 entity_visibility 自动生成"结构真、内容稀"的桩
 * (诚实: 壳铁实 / 内容待丰满)。流程不变 —— 新图进 pending_prototype, 旧 preview 不动。
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Screen } from "@atlas/shared";
import { DATA_ROOT, dataPath } from "./fileReader";
import { buildIASnapshot, writeIASnapshot } from "./iaBuilder";
import { loadScreen, loadScreens } from "./screenLoader";
import { submitPrototype } from "./prototypeQueue";

const atlasRoot = path.resolve(DATA_ROOT, "..");
const SHELL_VER = "v1";

export class RenderError extends Error {
  constructor(message: string, public readonly httpStatus: number) {
    super(message);
    this.name = "RenderError";
  }
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 从真源 screen 生成"结构真、内容稀"的桩内容区(字段取自 entity_visibility)。 */
function stubContent(screen: Screen): string {
  const purpose = (screen.body.match(/##\s*用途\s*\n+([^\n]+)/) ?? [])[1]?.trim() ?? "";
  const cards = Object.entries(screen.entity_visibility)
    .map(([ent, vis]) => {
      const rows = (vis.default ?? [])
        .map((f) => `      <div class="r"><span class="k">${esc(f)}</span><span class="v">—</span></div>`)
        .join("\n");
      return `    <div class="card"><div class="hd">${esc(ent)}</div><div class="bd">\n${rows}\n    </div></div>`;
    })
    .join("\n");
  return `<style>
  .pg{padding:22px 26px}
  .pg h2{font-size:17px;font-weight:700;color:var(--text-main)}
  .pg .use{font-size:13px;color:var(--text-sub);margin:6px 0 18px;max-width:760px}
  .pg .badge{display:inline-block;font-size:10px;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;padding:1px 7px;margin-left:8px;vertical-align:middle}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;align-items:start}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px}
  .card .hd{padding:10px 14px;border-bottom:1px solid var(--border);font-size:13px;font-weight:600;color:var(--text-main)}
  .card .bd{padding:8px 14px}
  .r{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f3f7;font-size:12px}
  .r:last-child{border-bottom:none}
  .r .k{color:var(--text-sub)}
  .r .v{color:var(--text-muted)}
</style>
<div class="pg">
  <h2>${esc(screen.name)}<span class="badge">桩内容 · 字段源自 entity_visibility</span></h2>
  <p class="use">${esc(purpose)}</p>
  <div class="grid">
${cards}
  </div>
</div>
`;
}

/** 确保 IA.json 存在(缺则从真源组装)。 */
async function ensureIA(productId: string): Promise<void> {
  const iaPath = dataPath("products", productId, "shells", SHELL_VER, "IA.json");
  if (existsSync(iaPath)) return;
  const snap = await buildIASnapshot(productId, { version: SHELL_VER });
  await writeIASnapshot(productId, snap, SHELL_VER);
}

/** 确保内容区存在(缺则从真源生成桩)。返回 true=新建了桩。 */
async function ensureContent(productId: string, moduleName: string, screenId: string): Promise<boolean> {
  const contentPath = dataPath("products", productId, "shells", SHELL_VER, "content", `${screenId}.html`);
  if (existsSync(contentPath)) return false;
  const screen = await loadScreen(productId, moduleName, screenId);
  if (!screen) throw new RenderError(`screen 不存在: ${moduleName}/${screenId}`, 404);
  await fs.mkdir(path.dirname(contentPath), { recursive: true });
  await fs.writeFile(contentPath, stubContent(screen), "utf8");
  return true;
}

export interface RenderResult {
  module: string;
  screenId: string;
  pending_prototype: string;
  stubbed: boolean;
}

/** 渲染单屏(壳+内容→PNG)并喂进三态闸。 */
export async function renderAndSubmitScreen(
  productId: string,
  moduleName: string,
  screenId: string
): Promise<RenderResult> {
  await ensureIA(productId);
  const stubbed = await ensureContent(productId, moduleName, screenId);

  const productDir = dataPath("products", productId);
  const script = path.join(atlasRoot, "scripts", "render-shell.mjs");
  const r = spawnSync("node", [script, productDir, screenId], { encoding: "utf8", timeout: 60_000 });
  const outPng = dataPath("products", productId, "shells", SHELL_VER, "out", `${screenId}.png`);
  if (r.status !== 0 || !existsSync(outPng)) {
    const msg = (r.stderr || r.stdout || r.error?.message || "未知错误").trim().split("\n").pop();
    throw new RenderError(`渲染失败 (${moduleName}/${screenId}): ${msg}`, 500);
  }

  const { pending_prototype } = await submitPrototype({ productId, moduleName, screenId, imagePath: outPng });
  return { module: moduleName, screenId, pending_prototype, stubbed };
}

/** 抽干待渲染队列: 渲染所有 needs_prototype 的屏并提交。返回每屏结果。 */
export async function drainRenderQueue(productId: string): Promise<RenderResult[]> {
  const screens = await loadScreens(productId);
  const queued = screens.filter((s) => s.needs_prototype);
  const out: RenderResult[] = [];
  for (const s of queued) {
    out.push(await renderAndSubmitScreen(productId, s.module, s.id));
  }
  return out;
}
