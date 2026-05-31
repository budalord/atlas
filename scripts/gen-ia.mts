#!/usr/bin/env -S npx tsx
// gen-ia.mts — 后端 IA 组装入口。从真源(MODULE.md groups + screen.group_id)
// 组装导航树并写出 data/products/<id>/shells/<version>/IA.json。
//
// 用法: npx tsx scripts/gen-ia.mts <productId> [version]
//
// 渲染管线(render-shell.mjs)消费这份 IA.json 生成壳的 nav —— 壳一致性收口在 Atlas 后端。

import { buildIASnapshot, writeIASnapshot } from "../apps/api/src/services/iaBuilder.js";

const productId = process.argv[2];
const version = process.argv[3] ?? "v1";
if (!productId) {
  console.error("用法: npx tsx scripts/gen-ia.mts <productId> [version]");
  process.exit(1);
}

const snap = await buildIASnapshot(productId, { version });
const out = await writeIASnapshot(productId, snap, version);
const screens = snap.modules.reduce(
  (n, m) => n + m.groups.reduce((k, g) => k + g.screens.length, 0) + m.ungrouped.length,
  0
);
console.log(`✓ ${out}`);
console.log(`  ${snap.modules.length} 模块 / ${screens} 屏 / status=${snap.status}`);
