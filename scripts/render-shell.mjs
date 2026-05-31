#!/usr/bin/env node
// render-shell.mjs — 把"冻结壳 + 屏内容区"拼成自包含 HTML，再用 headless Chrome 渲成 PNG。
//
// 这是渲染管线的 PoC 实现 (设计 Step 3)。命题验证: 16 屏共用同一 shell.html →
// nav 漂移结构性归零 (不靠模型，靠复用)。生成器(内容区)此处由人手搓充当。
//
// 用法:
//   node scripts/render-shell.mjs <productDir> <screenId>
// 例:
//   node scripts/render-shell.mjs data/products/yunkai-erp academic-student-profile
//
// 输入:
//   <productDir>/shells/v1/shell.html                 冻结壳模板 (带 {{...}} 注入点)
//   <productDir>/shells/v1/content/<screenId>.html    内容区 (generator output)
//   <productDir>/modules/*/screens/<screenId>.md      取 module / group_id (frontmatter)
// 输出:
//   <productDir>/shells/v1/out/<screenId>.html        自包含页 (壳+内容, HTML 起点)
//   <productDir>/shells/v1/out/<screenId>.png         1440×900 截图 (进审核闸)

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHELL_VER = "v1";

function die(msg) { console.error("✗ " + msg); process.exit(1); }

const [, , productDirArg, screenId] = process.argv;
if (!productDirArg || !screenId) die("用法: node scripts/render-shell.mjs <productDir> <screenId>");

const productDir = resolve(productDirArg);
const shellDir   = join(productDir, "shells", SHELL_VER);
const shellPath  = join(shellDir, "shell.html");
const contentPath = join(shellDir, "content", `${screenId}.html`);
const outDir     = join(shellDir, "out");
const outHtml    = join(outDir, `${screenId}.html`);
const outPng     = join(outDir, `${screenId}.png`);

if (!existsSync(shellPath))   die(`找不到冻结壳: ${shellPath}`);
if (!existsSync(contentPath)) die(`找不到内容区: ${contentPath} (需先由生成器产出)`);
if (!existsSync(CHROME))      die(`找不到 Chrome: ${CHROME}`);

// ── 从 screen.md frontmatter 取 module / group_id ──────────────────────
async function findScreenMd(id) {
  const modulesDir = join(productDir, "modules");
  for (const mod of await readdir(modulesDir)) {
    const p = join(modulesDir, mod, "screens", `${id}.md`);
    if (existsSync(p)) return p;
  }
  return null;
}
const mdPath = await findScreenMd(screenId);
if (!mdPath) die(`找不到 screen 规格: modules/*/screens/${screenId}.md`);

const md = await readFile(mdPath, "utf8");
const fm = md.split(/^---$/m)[1] || "";
const grab = (key) => (fm.match(new RegExp(`^${key}:\\s*(.+)$`, "m")) || [])[1]?.trim();
const moduleId = grab("module");
const groupId  = grab("group_id");
if (!moduleId) die(`${screenId} 缺 module 字段`);
if (!groupId)  die(`${screenId} 缺 group_id 字段 (Step 2 应已补)`);

// ── 拼装: 壳 + 内容 + 高亮位 ──────────────────────────────────────────
const shell   = await readFile(shellPath, "utf8");
const content = await readFile(contentPath, "utf8");

const assembled = shell
  .replaceAll("{{MODULE}}", moduleId)
  .replaceAll("{{GROUP}}", groupId)
  .replaceAll("{{SCREEN}}", screenId)
  .replace("{{CONTENT}}", content);   // 内容含 $ 等字符，用单次 replace 避免 $& 误解析

const leftover = assembled.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) die(`仍有未替换的注入点: ${[...new Set(leftover)].join(", ")}`);

await mkdir(outDir, { recursive: true });
await writeFile(outHtml, assembled, "utf8");
console.log(`✓ 自包含页: ${outHtml}`);
console.log(`  module=${moduleId}  group=${groupId}  screen=${screenId}`);

// ── headless Chrome → PNG ─────────────────────────────────────────────
const r = spawnSync(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-color-profile=srgb",
  "--default-background-color=00000000",
  "--virtual-time-budget=1500",   // 等注入脚本跑完
  "--window-size=1440,900",
  `--screenshot=${outPng}`,
  `file://${outHtml}`,
], { encoding: "utf8" });

if (r.status !== 0 || !existsSync(outPng)) {
  die(`Chrome 截图失败 (status ${r.status})\n${r.stderr || ""}`);
}
console.log(`✓ PNG: ${outPng}`);
