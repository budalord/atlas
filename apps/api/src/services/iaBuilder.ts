/**
 * IA builder · 全局壳信息架构(导航树)生成器。
 *
 * 从真源组装机器可读的 IASnapshot:
 *   MODULE.md frontmatter(name/role/color/order/groups) + screen.group_id
 * 分桶逻辑忠实镜像 FeatureTab.buildModuleNode(三层 markmap 树), 仅把分桶键从
 * feature.module_group 换成 screen.group_id、桶内装 screen。
 *
 * 产物 IA.json 是 shell 渲染 / 版本化 / IA 审核闸的输入真源。
 * 手写的 IA.md 仅为人读设计稿, 不被消费、不是真源。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  IASnapshot,
  IAModuleNode,
  IAGroup,
  IAScreenRef,
  ModuleSpec,
  Screen
} from "@atlas/shared";
import { loadModules } from "./entityLoader.js";
import { loadScreens } from "./screenLoader.js";
import { dataPath } from "./fileReader.js";

const UNGROUPED = "__ungrouped__";

export interface BuildIAOptions {
  shellId?: string;
  version?: string;
  status?: "draft" | "frozen";
  /** ISO 时间戳; 缺省取当前时间。 */
  generatedAt?: string;
}

export async function buildIASnapshot(
  productId: string,
  opts: BuildIAOptions = {}
): Promise<IASnapshot> {
  const [modules, screens] = await Promise.all([
    loadModules(productId),
    loadScreens(productId)
  ]);

  // screens 按 module 归集(screen.module = module 目录名 = ModuleSpec.name)
  const byModule = new Map<string, Screen[]>();
  for (const s of screens) {
    const list = byModule.get(s.module);
    if (list) list.push(s);
    else byModule.set(s.module, [s]);
  }

  const modNodes: IAModuleNode[] = modules.map((m) =>
    buildModuleNode(m, byModule.get(m.name) ?? byModule.get(m.id ?? m.name) ?? [])
  );

  return {
    shell_id: opts.shellId ?? `${productId}-shell`,
    version: opts.version ?? "v1",
    status: opts.status ?? "draft",
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    product: productId,
    modules: modNodes
  };
}

function ref(s: Screen): IAScreenRef {
  return { id: s.id, name: s.name };
}

function buildModuleNode(m: ModuleSpec, screens: Screen[]): IAModuleNode {
  // group 顺序:MODULE.md 声明顺序;未声明但被引用的 group 按出现顺序追加(校验会阻断,这里兜底)。
  const declared = m.groups ?? [];
  const nameById = new Map(declared.map((g) => [g.id, g.name] as const));
  const orderById = new Map(declared.map((g) => [g.id, g.order] as const));

  const groupOrder: string[] = declared.map((g) => g.id);
  const bucket = new Map<string, Screen[]>();
  declared.forEach((g) => bucket.set(g.id, []));

  for (const s of screens) {
    const gid = s.group_id?.trim();
    const key = gid && gid.length > 0 ? gid : UNGROUPED;
    if (!bucket.has(key)) {
      bucket.set(key, []);
      if (key !== UNGROUPED) groupOrder.push(key);
    }
    bucket.get(key)!.push(s);
  }

  const groups: IAGroup[] = groupOrder.map((id) => {
    const order = orderById.get(id);
    return {
      id,
      name: nameById.get(id) ?? `${id} ⚠`, // ⚠: 引用了 MODULE.md 未声明的 group
      ...(order !== undefined ? { order } : {}),
      screens: (bucket.get(id) ?? []).map(ref).sort((a, b) => a.id.localeCompare(b.id))
    };
  });
  const ungrouped = (bucket.get(UNGROUPED) ?? [])
    .map(ref)
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    id: m.id ?? m.name,
    name: m.title || m.name,
    ...(m.color ? { color: m.color } : {}),
    ...(m.order !== undefined ? { order: m.order } : {}),
    ...(m.role ? { role: m.role } : {}),
    groups,
    ungrouped
  };
}

/** 落盘到 data/products/<id>/shells/<version>/IA.json。返回写入路径。 */
export async function writeIASnapshot(
  productId: string,
  snap: IASnapshot,
  version: string = snap.version
): Promise<string> {
  const out = dataPath("products", productId, "shells", version, "IA.json");
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, `${JSON.stringify(snap, null, 2)}\n`, "utf8");
  return out;
}
