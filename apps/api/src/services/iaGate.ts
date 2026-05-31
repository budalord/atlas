/**
 * IA 审核闸 · 全局壳版本化 + 变更传播。
 *
 * 设计约束(用户): **流程不能变、产出要求不变**。
 * 因此本闸不另起炉灶 —— 不新建平行审核状态机。它只做两件增量的事:
 *   1. 版本化: 把组装出的 IASnapshot 冻结为 shells/<version>/IA.json(status=frozen)。
 *   2. diff: 冻结版 vs 新组装版的结构差异(模块/组/屏 的增删改移), 供人审。
 * 变更传播复用既有三态闸: shell 一变, 嵌了壳的原型图全过时 —— 语义等同"规格变→图过时",
 * 直接调 prototypeQueue.flagRevisedScreensForReprototype 把有图的屏重新入 needs_prototype 队。
 *
 * 心智: 菜单变 = ShellIA@vN→@vN+1 全量重生, 只在壳一处改、受控传播到现有出图闸。
 */

import { promises as fs } from "node:fs";
import type { IASnapshot, IADiff, IADiffEntry, IAModuleNode, IAGroup } from "@atlas/shared";
import { dataPath } from "./fileReader.js";
import { buildIASnapshot, writeIASnapshot } from "./iaBuilder.js";
import { loadScreens } from "./screenLoader.js";
import { flagRevisedScreensForReprototype } from "./prototypeQueue.js";

/** 组装当前真源 IA 并冻结为 shells/<version>/IA.json(status=frozen)。返回写入路径。 */
export async function freezeIA(
  productId: string,
  version: string,
  generatedAt?: string
): Promise<string> {
  const snap = await buildIASnapshot(productId, {
    version,
    status: "frozen",
    ...(generatedAt ? { generatedAt } : {})
  });
  return writeIASnapshot(productId, snap, version);
}

/** 读冻结版 IA.json;不存在返回 null。 */
export async function loadFrozenIA(
  productId: string,
  version: string
): Promise<IASnapshot | null> {
  const p = dataPath("products", productId, "shells", version, "IA.json");
  try {
    return JSON.parse(await fs.readFile(p, "utf8")) as IASnapshot;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

// ── 纯函数: 两版 IA 结构 diff ──────────────────────────────────────

function indexGroups(m: IAModuleNode): Map<string, IAGroup> {
  return new Map(m.groups.map((g) => [g.id, g] as const));
}

function diffScreens(
  modId: string,
  group: IAGroup,
  oldScreens: Map<string, string>, // screenId → groupId(在旧版整模块内)
  newScreens: Map<string, string>,
  entries: IADiffEntry[]
): void {
  for (const s of group.screens) {
    const prevGroup = oldScreens.get(s.id);
    if (prevGroup === undefined) {
      entries.push({
        level: "screen",
        change: "added",
        id: s.id,
        path: `${modId}/${group.id}/${s.id}`,
        detail: `新增屏 ${s.name}(组 ${group.id})`
      });
    } else if (prevGroup !== group.id) {
      entries.push({
        level: "screen",
        change: "moved",
        id: s.id,
        path: `${modId}/${group.id}/${s.id}`,
        detail: `屏 ${s.id} 移动: ${prevGroup} → ${group.id}`
      });
    }
  }
}

/** 整模块内 screenId → groupId 映射(含 ungrouped)。 */
function screensOf(m: IAModuleNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const g of m.groups) for (const s of g.screens) out.set(s.id, g.id);
  for (const s of m.ungrouped) out.set(s.id, "__ungrouped__");
  return out;
}

export function diffIA(oldSnap: IASnapshot, newSnap: IASnapshot): IADiff {
  const entries: IADiffEntry[] = [];
  const oldMods = new Map(oldSnap.modules.map((m) => [m.id, m] as const));
  const newMods = new Map(newSnap.modules.map((m) => [m.id, m] as const));

  // 模块增删
  for (const m of newSnap.modules) {
    if (!oldMods.has(m.id)) {
      entries.push({ level: "module", change: "added", id: m.id, path: m.id, detail: `新增模块 ${m.name}` });
    }
  }
  for (const m of oldSnap.modules) {
    if (!newMods.has(m.id)) {
      entries.push({ level: "module", change: "removed", id: m.id, path: m.id, detail: `删除模块 ${m.name}` });
    }
  }

  // 模块内: 组增删改名 + 屏增删移
  for (const nm of newSnap.modules) {
    const om = oldMods.get(nm.id);
    if (!om) continue; // 新模块整体已记为 added
    if (om.name !== nm.name) {
      entries.push({ level: "module", change: "renamed", id: nm.id, path: nm.id, detail: `模块改名: ${om.name} → ${nm.name}` });
    }
    const oldGroups = indexGroups(om);
    const newGroups = indexGroups(nm);
    const oldScreens = screensOf(om);
    const newScreens = screensOf(nm);

    for (const g of nm.groups) {
      const og = oldGroups.get(g.id);
      if (!og) {
        entries.push({ level: "group", change: "added", id: g.id, path: `${nm.id}/${g.id}`, detail: `新增组 ${g.name}` });
      } else if (og.name !== g.name) {
        entries.push({ level: "group", change: "renamed", id: g.id, path: `${nm.id}/${g.id}`, detail: `组改名: ${og.name} → ${g.name}` });
      }
      diffScreens(nm.id, g, oldScreens, newScreens, entries);
    }
    for (const g of om.groups) {
      if (!newGroups.has(g.id)) {
        entries.push({ level: "group", change: "removed", id: g.id, path: `${nm.id}/${g.id}`, detail: `删除组 ${g.name}` });
      }
    }
    // 屏删除(在旧版有、新版整模块都没了)
    for (const [sid, gid] of oldScreens) {
      if (!newScreens.has(sid)) {
        entries.push({ level: "screen", change: "removed", id: sid, path: `${nm.id}/${gid}/${sid}`, detail: `删除屏 ${sid}(原组 ${gid})` });
      }
    }
  }

  return { from: oldSnap.version, to: newSnap.version, changed: entries.length > 0, entries };
}

/** 组装当前真源 IA, 与冻结版 diff。冻结版不存在 → changed=false 空 diff。 */
export async function diffAgainstFrozen(
  productId: string,
  frozenVersion: string,
  newVersion: string
): Promise<IADiff> {
  const frozen = await loadFrozenIA(productId, frozenVersion);
  const live = await buildIASnapshot(productId, { version: newVersion });
  if (!frozen) return { from: frozenVersion, to: newVersion, changed: false, entries: [] };
  return diffIA(frozen, live);
}

/**
 * shell 变更传播: 复用既有三态闸。壳嵌进每张原型图, 壳一变图全过时 ——
 * 把所有"已有 preview_image、不在队 / 不在待审"的屏重新入 needs_prototype 队。
 * 流程完全不变(等同规格变触发的重出)。返回被入队的 "module/screenId" 列表。
 */
export async function propagateShellChange(productId: string): Promise<string[]> {
  const screens = await loadScreens(productId);
  const changedFiles = screens.map((s) => ({
    path: `modules/${s.module}/screens/${s.id}.md`
  }));
  return flagRevisedScreensForReprototype(productId, changedFiles);
}

/** 只读: 算出一次 shell 变更会重新入队哪些屏(有图、未在闸内), 不写盘。供审核前预览。 */
export async function previewShellAffected(productId: string): Promise<string[]> {
  const screens = await loadScreens(productId);
  return screens
    .filter((s) => s.preview_image && !s.needs_prototype && !s.pending_prototype)
    .map((s) => `${s.module}/${s.id}`)
    .sort();
}
