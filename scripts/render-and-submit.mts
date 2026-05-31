#!/usr/bin/env -S npx tsx
// render-and-submit.mts — Atlas 侧渲染收口桥。
//
// 设计「渲染收口在 Atlas」的落地: 壳(IA.json 真源)+ 内容区 HTML → PNG → 喂进现有三态闸。
// drain 客户端只需回传内容区 HTML(此处由 shells/v1/content/<screen>.html 充当);
// 渲染与入闸都收口在 Atlas, 壳一致性不受客户端环境影响。
//
// 复用既有 submitPrototype: 流程完全不变 —— 新图进 pending_prototype 待审,
// 已通过的 preview_image 绝不被覆盖(重出/迭代语义)。
//
// 用法: npx tsx scripts/render-and-submit.mts <productId> <screenId>

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { submitPrototype } from "../apps/api/src/services/prototypeQueue.js";

const productId = process.argv[2];
const screenId = process.argv[3];
if (!productId || !screenId) {
  console.error("用法: npx tsx scripts/render-and-submit.mts <productId> <screenId>");
  process.exit(1);
}

const productDir = resolve("data/products", productId);
const outPng = join(productDir, "shells", "v1", "out", `${screenId}.png`);

// 找 screen 所属 module
async function findModule(id: string): Promise<string | null> {
  const modulesDir = join(productDir, "modules");
  for (const mod of await readdir(modulesDir)) {
    if (existsSync(join(modulesDir, mod, "screens", `${id}.md`))) return mod;
  }
  return null;
}
const moduleName = await findModule(screenId);
if (!moduleName) { console.error(`✗ 找不到 screen: ${screenId}`); process.exit(1); }

// 1. 渲染(壳从 IA.json 生成 + 内容区 → PNG)
const r = spawnSync("node", ["scripts/render-shell.mjs", `data/products/${productId}`, screenId], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});
if (r.status !== 0 || !existsSync(outPng)) {
  console.error(`✗ 渲染失败\n${r.stdout || ""}${r.stderr || ""}`);
  process.exit(1);
}
console.log(`✓ 渲染 → ${outPng.split("/").slice(-1)[0]}`);

// 2. 喂进现有三态闸: 新图进 pending_prototype(不碰 preview_image)
const { pending_prototype } = await submitPrototype({ productId, moduleName, screenId, imagePath: outPng });
console.log(`✓ 入审核闸 pending_prototype: ${pending_prototype}`);
console.log(`  → 走现有 approve(升 preview_image)/ reject(丢弃重出)闸, 流程未变。`);
