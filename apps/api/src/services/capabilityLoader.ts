import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  Capability,
  CapabilityPriority,
  CapabilitySource,
  CapabilityStatus,
  CapabilityWithRefs,
  FeaturePoint
} from "@atlas/shared";
import {
  dataPath,
  listMarkdownFiles,
  pathExists,
  readTextFile
} from "./fileReader";
import { parseMarkdownWithFrontmatter } from "./markdownParser";

/**
 * Capability loader · 项目级业务能力 (`capabilities/<id>.md`)。
 *
 * 见 docs/capability-contract.md。
 * **不缓存** (规则 5), **反向引用运行时聚合** (规则 4)。
 */

const VALID_STATUS = new Set<CapabilityStatus>(["draft", "confirmed"]);
const VALID_PRIORITY = new Set<CapabilityPriority>(["P0", "P1", "P2"]);
const VALID_SOURCE = new Set<CapabilitySource>([
  "user_input",
  "agent_suggested",
  "inferred_from_features"
]);

/** Domain 预定义池(规则 2)。约束在 capability-contract.md §2.1。 */
export const DOMAIN_POOL = ["招生", "教务", "财务", "人事", "数据集成", "决策与报表"] as const;

interface CapabilityFrontmatter {
  id?: unknown;
  name?: unknown;
  domain?: unknown;
  value_statement?: unknown;
  actor_ids?: unknown;
  entity_ids?: unknown;
  priority?: unknown;
  status?: unknown;
  source?: unknown;
  confirmed?: unknown;
}

export function capabilitiesDir(productId: string): string {
  return dataPath("products", productId, "capabilities");
}

export async function loadCapabilities(productId: string): Promise<Capability[]> {
  if (!(await pathExists("products", productId, "capabilities"))) return [];
  let files: string[];
  try {
    files = await listMarkdownFiles("products", productId, "capabilities");
  } catch {
    return [];
  }
  const out: Capability[] = [];
  const dir = capabilitiesDir(productId);
  for (const fname of files) {
    const filePath = path.join(dir, fname);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const cap = parseCapability(fname.replace(/\.md$/, ""), content);
      if (cap) out.push(cap);
    } catch {
      // skip
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

export async function loadCapability(productId: string, capabilityId: string): Promise<Capability | null> {
  const source = await readTextFile("products", productId, "capabilities", `${capabilityId}.md`);
  if (source === null) return null;
  return parseCapability(capabilityId, source);
}

export function parseCapability(idFromFile: string, source: string): Capability | null {
  const parsed = parseMarkdownWithFrontmatter<CapabilityFrontmatter>(source, {});
  const fm = parsed.frontmatter;
  const id = typeof fm.id === "string" ? fm.id.trim() : idFromFile;
  if (!id) return null;
  const name = typeof fm.name === "string" && fm.name.trim().length > 0
    ? fm.name.trim()
    : id;
  const domain = typeof fm.domain === "string" && fm.domain.trim().length > 0
    ? fm.domain.trim()
    : "未分类";
  const value_statement = typeof fm.value_statement === "string"
    ? fm.value_statement.trim()
    : "";
  const actor_ids = normalizeStringArray(fm.actor_ids);
  const entity_ids = normalizeStringArray(fm.entity_ids);
  const priorityRaw = typeof fm.priority === "string" ? fm.priority.trim() : "";
  const priority: CapabilityPriority = VALID_PRIORITY.has(priorityRaw as CapabilityPriority)
    ? (priorityRaw as CapabilityPriority)
    : "P1";
  const statusRaw = typeof fm.status === "string" ? fm.status.trim() : "";
  const status: CapabilityStatus = VALID_STATUS.has(statusRaw as CapabilityStatus)
    ? (statusRaw as CapabilityStatus)
    : "draft";
  const sourceRaw = typeof fm.source === "string" ? fm.source.trim() : "";
  const sourceVal: CapabilitySource = VALID_SOURCE.has(sourceRaw as CapabilitySource)
    ? (sourceRaw as CapabilitySource)
    : "user_input";
  const confirmed = fm.confirmed === true;
  return {
    id,
    name,
    domain,
    value_statement,
    actor_ids,
    entity_ids,
    priority,
    status,
    source: sourceVal,
    confirmed,
    body: parsed.body.trim()
  };
}

function normalizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/**
 * 反向聚合: function_ids = 所有 capability_id == this.id 的 function id 列表。
 */
export function attachCapabilityRefs(
  capabilities: Capability[],
  functions: FeaturePoint[]
): CapabilityWithRefs[] {
  return capabilities.map((cap) => ({
    ...cap,
    function_ids: functions.filter((f) => f.capability_id === cap.id).map((f) => f.id)
  }));
}

export async function writeCapability(productId: string, cap: Capability): Promise<void> {
  const fmObj: Record<string, unknown> = {
    id: cap.id,
    name: cap.name,
    domain: cap.domain,
    value_statement: cap.value_statement,
    actor_ids: cap.actor_ids,
    entity_ids: cap.entity_ids,
    priority: cap.priority,
    status: cap.status,
    source: cap.source,
    confirmed: cap.confirmed
  };
  const fmText = YAML.stringify(fmObj).trim();
  const body = cap.body.trim();
  const content = `---\n${fmText}\n---\n\n# ${cap.name}\n\n${body}\n`;
  const filePath = path.join(capabilitiesDir(productId), `${cap.id}.md`);
  await fs.mkdir(capabilitiesDir(productId), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export async function deleteCapability(productId: string, capabilityId: string): Promise<boolean> {
  const filePath = path.join(capabilitiesDir(productId), `${capabilityId}.md`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
