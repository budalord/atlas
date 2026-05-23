import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  Actor,
  ActorSource,
  ActorType,
  ActorWithRefs,
  Capability,
  FeaturePoint,
  UseCase
} from "@atlas/shared";
import {
  dataPath,
  listMarkdownFiles,
  pathExists,
  readTextFile
} from "./fileReader";
import { parseMarkdownWithFrontmatter } from "./markdownParser";

/**
 * Actor loader · 项目级 first-class 角色对象。
 *
 * 物理路径: `data/products/<id>/actors/<actor_id>.md`
 * 见 docs/actor-contract.md
 *
 * **不缓存** (规则 5), 每次请求 loader 走盘。
 * **反向引用运行时聚合** (规则 4): related_capability_ids / related_function_ids / related_usecase_ids 不入 md, 由 loadActorsWithRefs 现场算。
 */

const VALID_ACTOR_TYPES = new Set<ActorType>(["internal_user", "external_user", "external_system"]);
const VALID_ACTOR_SOURCES = new Set<ActorSource>(["user_input", "agent_suggested", "inferred_from_function"]);

interface ActorFrontmatter {
  id?: unknown;
  name?: unknown;
  type?: unknown;
  source?: unknown;
  confirmed?: unknown;
  code?: unknown;
  responsibilities?: unknown;
}

export function actorsDir(productId: string): string {
  return dataPath("products", productId, "actors");
}

export async function loadActors(productId: string): Promise<Actor[]> {
  const dir = actorsDir(productId);
  if (!(await pathExists("products", productId, "actors"))) return [];
  let files: string[];
  try {
    files = await listMarkdownFiles("products", productId, "actors");
  } catch {
    return [];
  }
  const out: Actor[] = [];
  for (const fname of files) {
    const filePath = path.join(dir, fname);
    try {
      const content = await fs.readFile(filePath, "utf8");
      const actor = parseActor(fname.replace(/\.md$/, ""), content);
      if (actor) out.push(actor);
    } catch {
      // skip unreadable
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * 加载单个 actor (用于 GET /:actorId 直接定位)。
 */
export async function loadActor(productId: string, actorId: string): Promise<Actor | null> {
  const source = await readTextFile("products", productId, "actors", `${actorId}.md`);
  if (source === null) return null;
  return parseActor(actorId, source);
}

export function parseActor(idFromFile: string, source: string): Actor | null {
  const parsed = parseMarkdownWithFrontmatter<ActorFrontmatter>(source, {});
  const fm = parsed.frontmatter;
  const id = typeof fm.id === "string" ? fm.id.trim() : idFromFile;
  if (!id) return null;
  const name = typeof fm.name === "string" && fm.name.trim().length > 0
    ? fm.name.trim()
    : id;
  const typeRaw = typeof fm.type === "string" ? fm.type.trim() : "";
  const type: ActorType = VALID_ACTOR_TYPES.has(typeRaw as ActorType)
    ? (typeRaw as ActorType)
    : "internal_user"; // 容错默认
  const sourceRaw = typeof fm.source === "string" ? fm.source.trim() : "";
  const sourceVal: ActorSource = VALID_ACTOR_SOURCES.has(sourceRaw as ActorSource)
    ? (sourceRaw as ActorSource)
    : "user_input";
  const confirmed = fm.confirmed === true;
  const code = typeof fm.code === "string" && fm.code.trim().length > 0 ? fm.code.trim() : undefined;
  const responsibilities = typeof fm.responsibilities === "string" && fm.responsibilities.trim().length > 0
    ? fm.responsibilities.trim()
    : undefined;
  return {
    id,
    name,
    type,
    source: sourceVal,
    confirmed,
    ...(code ? { code } : {}),
    ...(responsibilities ? { responsibilities } : {}),
    body: parsed.body.trim()
  };
}

/**
 * 加载 actors + 运行时聚合反向引用。
 *
 * 入参 capabilities / functions / usecases 由调用方传入(避免重复读盘)。
 * 反向引用规则:
 *   - related_capability_ids: 扫所有 capability.actor_ids 含 actor.id
 *   - related_function_ids:   扫所有 function.actor_ids 含 actor.id
 *   - related_usecase_ids:    扫所有 usecase.actor_id == actor.id
 */
export function attachActorRefs(
  actors: Actor[],
  capabilities: Capability[],
  functions: FeaturePoint[],
  usecases: UseCase[]
): ActorWithRefs[] {
  return actors.map((actor) => {
    const related_capability_ids = capabilities
      .filter((c) => c.actor_ids.includes(actor.id))
      .map((c) => c.id);
    const related_function_ids = functions
      .filter((f) => (f.actor_ids ?? []).includes(actor.id))
      .map((f) => f.id);
    const related_usecase_ids = usecases
      .filter((u) => u.actor_id === actor.id)
      .map((u) => ({ function_id: u.function_id, usecase_id: u.id }));
    return {
      ...actor,
      related_capability_ids,
      related_function_ids,
      related_usecase_ids
    };
  });
}

/**
 * 写 actor.md (POST/PATCH 用)。frontmatter + body。
 */
export async function writeActor(
  productId: string,
  actor: Actor
): Promise<void> {
  const fmObj: Record<string, unknown> = {
    id: actor.id,
    name: actor.name,
    type: actor.type,
    source: actor.source,
    confirmed: actor.confirmed
  };
  if (actor.code) fmObj.code = actor.code;
  if (actor.responsibilities) fmObj.responsibilities = actor.responsibilities;
  const fmText = YAML.stringify(fmObj).trim();
  const body = actor.body.trim();
  const content = `---\n${fmText}\n---\n\n# ${actor.name}\n\n${body}\n`;
  const filePath = path.join(actorsDir(productId), `${actor.id}.md`);
  await fs.mkdir(actorsDir(productId), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

export async function deleteActor(productId: string, actorId: string): Promise<boolean> {
  const filePath = path.join(actorsDir(productId), `${actorId}.md`);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
