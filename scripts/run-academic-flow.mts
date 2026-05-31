#!/usr/bin/env -S npx tsx
// run-academic-flow.mts — 跑一遍教务纵切全流程, 验证"壳冻结→杀死漂移"修复。
//
// 流程: 壳组装(IA.json) → 每屏内容区(没手搓的从真源 entity_visibility 自动生成桩)
//      → 全量渲染 → nav 逐字节哈希全等断言(漂移=0 的硬证) → 收口进现有三态闸。
// 另渲跨模块抽样, 证明壳在全产品唯一(不只教务内一致)。
//
// 用法: npx tsx scripts/run-academic-flow.mts

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { buildIASnapshot, writeIASnapshot } from "../apps/api/src/services/iaBuilder.js";
import { loadScreens } from "../apps/api/src/services/screenLoader.js";
import { submitPrototype } from "../apps/api/src/services/prototypeQueue.js";

const PID = "yunkai-erp";
const productDir = `data/products/${PID}`;
const contentDir = join(productDir, "shells", "v1", "content");
const outDir = join(productDir, "shells", "v1", "out");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 从真源 screen 生成"结构真、内容稀"的桩内容区(诚实呈现: 壳铁实 / 内容待丰满)
function stubContent(name: string, purpose: string, ev: Record<string, { default?: string[] }>): string {
  const cards = Object.entries(ev).map(([ent, vis]) => {
    const rows = (vis.default ?? [])
      .map((f) => `      <div class="r"><span class="k">${esc(f)}</span><span class="v">—</span></div>`)
      .join("\n");
    return `    <div class="card"><div class="hd">${esc(ent)}</div><div class="bd">\n${rows}\n    </div></div>`;
  }).join("\n");
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
  <h2>${esc(name)}<span class="badge">桩内容 · 字段源自 entity_visibility</span></h2>
  <p class="use">${esc(purpose)}</p>
  <div class="grid">
${cards}
  </div>
</div>
`;
}

// ── 1. 壳组装(真源 → IA.json) ─────────────────────────────────────
const snap = await buildIASnapshot(PID, { version: "v1" });
await writeIASnapshot(PID, snap, "v1");
console.log(`① 壳组装: IA.json ${snap.modules.length} 模块`);

const all = await loadScreens(PID);
const academic = all.filter((s) => s.module === "academic");
// 跨模块抽样: 每个有屏的非 academic 模块取第 1 个
const sampleByMod = new Map<string, typeof all[0]>();
for (const s of all) if (s.module !== "academic" && !sampleByMod.has(s.module)) sampleByMod.set(s.module, s);
const crossSamples = [...sampleByMod.values()];
const targets = [...academic, ...crossSamples];

// ── 2. 内容区: 没手搓的自动生成桩 ──────────────────────────────────
await mkdir(contentDir, { recursive: true });
let stubbed = 0, handAuthored = 0;
for (const s of targets) {
  const cf = join(contentDir, `${s.id}.html`);
  if (existsSync(cf)) { handAuthored++; continue; }
  const purpose = (s.body.match(/##\s*用途\s*\n+([^\n]+)/) ?? [])[1]?.trim() ?? "";
  await writeFile(cf, stubContent(s.name, purpose, s.entity_visibility), "utf8");
  stubbed++;
}
console.log(`② 内容区: 手搓 ${handAuthored} + 自动桩 ${stubbed} = ${targets.length}`);

// ── 3. 全量渲染 + 收集 nav <aside> 哈希 ────────────────────────────
const navHash = new Map<string, string>();
let renderFail = 0;
for (const s of targets) {
  const r = spawnSync("node", ["scripts/render-shell.mjs", productDir, s.id], { encoding: "utf8" });
  if (r.status !== 0 || !existsSync(join(outDir, `${s.id}.html`))) {
    console.log(`   ✗ 渲染失败 ${s.module}/${s.id}: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`);
    renderFail++; continue;
  }
  const html = await readFile(join(outDir, `${s.id}.html`), "utf8");
  const aside = html.match(/<aside class="nav">[\s\S]*?<\/aside>/)?.[0] ?? "";
  navHash.set(`${s.module}/${s.id}`, createHash("sha256").update(aside).digest("hex").slice(0, 12));
}
console.log(`③ 渲染: ${navHash.size} 屏成功${renderFail ? `, ${renderFail} 失败` : ""}`);

// ── 4. 硬证: 全屏 nav 唯一哈希 = 漂移 0 ────────────────────────────
const uniq = new Set(navHash.values());
const academicHashes = new Set([...navHash].filter(([k]) => k.startsWith("academic/")).map(([, v]) => v));
console.log(`④ 导航漂移检验:`);
console.log(`   教务 ${academicHashes.size === 1 ? "✓" : "✗"} ${[...navHash].filter(([k]) => k.startsWith("academic/")).length} 屏 nav 唯一哈希数=${academicHashes.size}`);
console.log(`   全产品 ${uniq.size === 1 ? "✓" : "✗"} ${navHash.size} 屏(含跨模块抽样)nav 唯一哈希数=${uniq.size}  [${[...uniq].join(", ")}]`);

// ── 5. 收口: 教务屏进现有三态闸(重出) ─────────────────────────────
let submitted = 0;
for (const s of academic) {
  if (!existsSync(join(outDir, `${s.id}.png`))) continue;
  await submitPrototype({ productId: PID, moduleName: "academic", screenId: s.id, imagePath: join(outDir, `${s.id}.png`) });
  submitted++;
}
console.log(`⑤ 收口: ${submitted} 教务屏进审核闸 pending(旧 preview 不动, 可走现有 reject 丢弃)`);

console.log(uniq.size === 1 && renderFail === 0
  ? `\n✓✓ 修复成功: ${navHash.size} 屏共用同一字节级壳, 漂移结构性为零`
  : `\n✗ 检查上面失败项`);
