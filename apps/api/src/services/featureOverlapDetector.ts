import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import YAML from "yaml";
import type { FeaturePoint, OverlapGroup, OverlapReport } from "@atlas/shared";
import { dataPath } from "./fileReader";
import { loadModules, loadFeatures } from "./entityLoader";

/**
 * Feature 重叠检测器。
 *
 * 目的: 立项阶段 features 集合常出现"同一动作被多个 feature 描述"导致实体派生噪音 +
 *      决策者重复审。本服务扫描全部 features, 找出"可能重复的一组"提示决策者。
 *
 * 算法:
 *   1. 同 (module, module_group) 桶内, 两两配对
 *   2. 算 entity Jaccard + name 双字 shingle Jaccard
 *   3. 阈值:
 *      - entityJaccard ≥ 0.7                          → 强信号: 实体重合
 *      - nameJaccard ≥ 0.5 AND entityJaccard ≥ 0.3    → 中信号: 名称+实体复合
 *      - nameJaccard ≥ 0.7                            → 弱信号: 名称高度相似
 *   4. 配对结果用 union-find 聚成组(同一组的所有 features 互为可能重复)
 *
 * sidecar `derived/features/overlap-ignored.yml` 记录用户已驳回的组, 下次不再提示。
 */

interface FeatureRef {
  moduleId: string;
  featureId: string;
  name: string;
  entities: string[];
}

const ENTITY_STRONG = 0.7;
const NAME_MEDIUM = 0.5;
const ENTITY_MEDIUM = 0.3;
const NAME_STRONG = 0.7;

export async function buildFeatureOverlapReport(productId: string): Promise<OverlapReport> {
  const modules = await loadModules(productId);
  const allRefs: Array<FeatureRef & { module_group: string | null }> = [];
  for (const m of modules) {
    const features = await loadFeatures(productId, m.name);
    for (const f of features) {
      allRefs.push({
        moduleId: m.name,
        featureId: f.id,
        name: f.name,
        entities: f.entities_touched ?? [],
        module_group: f.module_group?.trim() || null
      });
    }
  }

  // 同 (module, module_group) 桶内两两配对
  const bucketMap = new Map<string, typeof allRefs>();
  for (const ref of allRefs) {
    const key = `${ref.moduleId}::${ref.module_group ?? "_ungrouped"}`;
    if (!bucketMap.has(key)) bucketMap.set(key, []);
    bucketMap.get(key)!.push(ref);
  }

  // union-find
  const idOf = (r: FeatureRef) => `${r.moduleId}/${r.featureId}`;
  const parent = new Map<string, string>();
  const reasonsByEdge = new Map<string, Set<string>>(); // edge "a||b" (sorted) → reasons
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    parent.set(x, p);
    return p;
  };
  const union = (a: string, b: string) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent.set(pa, pb);
  };

  for (const refs of bucketMap.values()) {
    if (refs.length < 2) continue;
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const a = refs[i];
        const b = refs[j];
        const result = scorePair(a, b);
        if (!result) continue;
        const aid = idOf(a);
        const bid = idOf(b);
        parent.set(aid, parent.get(aid) ?? aid);
        parent.set(bid, parent.get(bid) ?? bid);
        union(aid, bid);
        const edgeKey = [aid, bid].sort().join("||");
        if (!reasonsByEdge.has(edgeKey)) reasonsByEdge.set(edgeKey, new Set());
        reasonsByEdge.get(edgeKey)!.add(result.reason);
      }
    }
  }

  // group by root
  const groupMembers = new Map<string, FeatureRef[]>();
  for (const ref of allRefs) {
    const id = idOf(ref);
    if (!parent.has(id)) continue;
    const root = find(id);
    if (!groupMembers.has(root)) groupMembers.set(root, []);
    groupMembers.get(root)!.push(ref);
  }

  // collect reasons per group (de-dup)
  const groupReasons = new Map<string, Set<string>>();
  for (const [edgeKey, reasons] of reasonsByEdge.entries()) {
    const [a] = edgeKey.split("||");
    const root = find(a);
    if (!groupReasons.has(root)) groupReasons.set(root, new Set());
    for (const r of reasons) groupReasons.get(root)!.add(r);
  }

  const ignored = await loadOverlapIgnored(productId);
  const ignoredKeys = new Set(ignored.map((g) => normalizeGroupKey(g.feature_ids)));

  const groups: OverlapGroup[] = [];
  for (const [root, members] of groupMembers.entries()) {
    if (members.length < 2) continue;
    members.sort((x, y) => idOf(x).localeCompare(idOf(y)));
    const memberKey = normalizeGroupKey(members.map(idOf));
    if (ignoredKeys.has(memberKey)) continue;
    groups.push({
      id: hashGroup(memberKey),
      features: members.map((m) => ({ moduleId: m.moduleId, featureId: m.featureId, name: m.name })),
      reasons: Array.from(groupReasons.get(root) ?? []).sort(),
      memberKey
    });
  }
  groups.sort((a, b) => b.features.length - a.features.length || a.id.localeCompare(b.id));

  return {
    groups,
    ignored_count: ignored.length
  };
}

/* ============================================================
 *  评分函数
 * ============================================================ */

function scorePair(
  a: { name: string; entities: string[] },
  b: { name: string; entities: string[] }
): { reason: string } | null {
  const ej = jaccard(new Set(a.entities), new Set(b.entities));
  const nj = jaccard(bigramShingles(normalizeName(a.name)), bigramShingles(normalizeName(b.name)));

  if (ej >= ENTITY_STRONG) {
    return { reason: `实体重合 ${pct(ej)}` };
  }
  if (nj >= NAME_MEDIUM && ej >= ENTITY_MEDIUM) {
    return { reason: `名称相似 ${pct(nj)} + 实体重合 ${pct(ej)}` };
  }
  if (nj >= NAME_STRONG) {
    return { reason: `名称高度相似 ${pct(nj)}` };
  }
  return null;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function normalizeName(name: string): string {
  // 去括号补充内容(中英文括号), 去末尾的 "·xxx" 后缀
  return name
    .replace(/[(（][^()（）]*[)）]/g, "")
    .replace(/[·•]\s*[^·•]+$/, "")
    .trim();
}

function bigramShingles(s: string): Set<string> {
  const out = new Set<string>();
  const cleaned = s.replace(/\s+/g, "");
  for (let i = 0; i + 1 < cleaned.length; i++) {
    const sh = cleaned.slice(i, i + 2);
    if (sh.length === 2) out.add(sh);
  }
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function normalizeGroupKey(memberIds: string[]): string {
  return [...memberIds].sort().join("||");
}

function hashGroup(key: string): string {
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/* ============================================================
 *  sidecar overlap-ignored.yml — 用户已驳回的组
 * ============================================================ */

export interface OverlapIgnoredEntry {
  feature_ids: string[]; // "module/featureId"
  decided_at: string;
  reason: string;
}

function overlapIgnoredPath(productId: string): string {
  return dataPath("products", productId, "derived", "features", "overlap-ignored.yml");
}

export async function loadOverlapIgnored(productId: string): Promise<OverlapIgnoredEntry[]> {
  try {
    const raw = await fs.readFile(overlapIgnoredPath(productId), "utf8");
    const parsed = YAML.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: OverlapIgnoredEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      const ids = Array.isArray(r.feature_ids)
        ? r.feature_ids.filter((x): x is string => typeof x === "string")
        : [];
      const decided_at = typeof r.decided_at === "string" ? r.decided_at : "";
      const reason = typeof r.reason === "string" ? r.reason : "";
      if (ids.length < 2 || !decided_at) continue;
      out.push({ feature_ids: ids, decided_at, reason });
    }
    return out;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    return [];
  }
}

export async function appendOverlapIgnored(
  productId: string,
  feature_ids: string[],
  reason: string
): Promise<OverlapIgnoredEntry> {
  const filePath = overlapIgnoredPath(productId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const state = await loadOverlapIgnored(productId);
  const newEntry: OverlapIgnoredEntry = {
    feature_ids: [...feature_ids].sort(),
    decided_at: new Date().toISOString(),
    reason: reason || ""
  };
  // 去重: 已有同 sorted feature_ids 的 → 覆盖
  const key = newEntry.feature_ids.join("||");
  const idx = state.findIndex((e) => [...e.feature_ids].sort().join("||") === key);
  if (idx >= 0) state[idx] = newEntry;
  else state.push(newEntry);
  await fs.writeFile(filePath, YAML.stringify(state), "utf8");
  return newEntry;
}

/** 提取 feature 一组的简短描述, 用于写入全局需求池让 agent 审。 */
export function buildOverlapFeedbackContent(group: { features: { moduleId: string; featureId: string; name: string }[]; reasons: string[] }): string {
  const lines = [
    `[overlap-check] 可能重复的 features (${group.features.length} 个):`,
    ...group.features.map((f) => `- ${f.moduleId}/${f.featureId}: ${f.name}`),
    `信号: ${group.reasons.join(" / ")}`,
    "请在下轮 revise 时:",
    "1. 合并到一个 feature(在 diff plan 说明合并理由 + 把多余反馈并入字段权限/状态分支),或",
    "2. 在 diff plan 中说明区分理由(actor/状态机/字段权限的本质差异)"
  ];
  return lines.join("\n");
}

/** FeaturePoint 类型适配 — 用于 service 间复用 */
export function refFromFeature(moduleId: string, f: FeaturePoint): FeatureRef {
  return {
    moduleId,
    featureId: f.id,
    name: f.name,
    entities: f.entities_touched ?? []
  };
}
