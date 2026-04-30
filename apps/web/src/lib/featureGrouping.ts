import type { FeatureSpec } from "../types";

export const UNGROUPED_KEY = "__ungrouped__";
export const UNGROUPED_LABEL = "未分组";

const PAGE_PATH_REGEX = /pages\/[\w-]+\/[\w-]+/;

/**
 * 剥离 markdown 强调标记(反引号、星号),便于正则匹配纯文本。
 */
function stripMarkdownEmphasis(s: string): string {
  return s.replace(/[`*]/g, "");
}

/**
 * 从功能点的 endpoint 字段中提取页面路径作为分组 key。
 * 匹配 `pages/<segment>/<segment>` 形式;匹配不到返回 null。
 * 容错:剥离反引号 / 星号等 markdown 标记后再匹配。
 */
export function extractPagePath(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null;
  const match = stripMarkdownEmphasis(endpoint).match(PAGE_PATH_REGEX);
  return match ? match[0] : null;
}

/**
 * 在功能点的多个字段中兜底搜索页面路径(endpoint > notes > description > status)。
 * 用于防御 STATUS.md 列错位导致 endpoint 为空、路径落到其他字段的情形。
 */
export function extractPagePathFromFeature(feature: {
  endpoint?: string | null;
  notes?: string | null;
  description?: string | null;
  status?: string | null;
}): string | null {
  return (
    extractPagePath(feature.endpoint) ??
    extractPagePath(feature.notes) ??
    extractPagePath(feature.description) ??
    extractPagePath(feature.status)
  );
}

export interface FeatureGroup {
  /** 分组 key:页面路径 或 UNGROUPED_KEY */
  key: string;
  /** 展示用的标签:页面路径 或 "未分组" */
  label: string;
  /** 是否为未分组 */
  isUngrouped: boolean;
  /** 该组的功能点 */
  features: FeatureSpec[];
}

/**
 * 把功能点按 endpoint 中的 pages/* 路径分组。
 * - 匹配不到的进入"未分组"
 * - 按组内功能数降序;"未分组"始终在最后
 * - 同等数量按 key 字典序稳定
 */
export function groupFeatures(features: FeatureSpec[]): FeatureGroup[] {
  const buckets = new Map<string, FeatureSpec[]>();

  for (const feature of features) {
    const path = extractPagePathFromFeature(feature);
    const key = path ?? UNGROUPED_KEY;
    const list = buckets.get(key);
    if (list) {
      list.push(feature);
    } else {
      buckets.set(key, [feature]);
    }
  }

  const groups: FeatureGroup[] = Array.from(buckets.entries()).map(([key, list]) => ({
    key,
    label: key === UNGROUPED_KEY ? UNGROUPED_LABEL : key,
    isUngrouped: key === UNGROUPED_KEY,
    features: list
  }));

  groups.sort((a, b) => {
    if (a.isUngrouped && !b.isUngrouped) return 1;
    if (!a.isUngrouped && b.isUngrouped) return -1;
    if (b.features.length !== a.features.length) return b.features.length - a.features.length;
    return a.key.localeCompare(b.key);
  });

  return groups;
}

/**
 * 状态分布字符串:`1 live · 2 重构中`。按数量降序、相同按 key 字典序。
 */
export function statusDistribution(features: FeatureSpec[]): string {
  const counts = new Map<string, number>();
  for (const f of features) {
    const s = (f.status ?? "").trim() || "未填写";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const entries = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });
  return entries.map(([s, n]) => `${n} ${s}`).join(" · ");
}

const ATTENTION_KEYWORDS = ["重构", "doing", "blocked", "todo"];

/**
 * 组内是否有任何 status 命中"重构 / doing / blocked / todo"。
 * 命中即默认展开。
 */
export function shouldDefaultExpand(features: FeatureSpec[]): boolean {
  return features.some((f) => {
    const s = (f.status ?? "").toLowerCase();
    return ATTENTION_KEYWORDS.some((kw) => s.includes(kw));
  });
}
