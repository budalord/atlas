import type { RolesRegistry, RoleDef } from "@atlas/shared";
import { readTextFile } from "./fileReader";
import { parseYaml } from "./markdownParser";

const DEFAULT_ROLES: RoleDef[] = [
  { id: "student", name: "学生", note: "接受教学服务的最终用户" },
  { id: "parent", name: "家长", note: "学生监护人/付费人" },
  { id: "teacher", name: "老师", note: "授课/批改" },
  { id: "sales", name: "销售", note: "招生/订单" },
  { id: "academic", name: "教务", note: "排课/学籍" },
  { id: "finance", name: "财务", note: "收款/退款/对账" },
  { id: "admin", name: "管理员", note: "系统配置/权限分配" }
];

const ID_RE = /^[a-z][a-z0-9-]*$/;

/**
 * 读取 data/roles.yml 并返回 RolesRegistry。
 *
 * - 文件不存在 → 回退到默认 7 角色(防御性,不阻塞 UI)
 * - YAML 解析失败 / 字段缺失 → 同样回退
 * - 文件很小(几百字节),每次直接读盘;不做内存缓存,watcher 触发的 SSE 已经让前端自动重 fetch
 */
export async function loadRolesRegistry(): Promise<RolesRegistry> {
  const src = await readTextFile("roles.yml");
  if (!src) return { version: 1, roles: DEFAULT_ROLES };
  try {
    const parsed = parseYaml<{ version?: number; roles?: unknown }>(src);
    const roles = Array.isArray(parsed.roles)
      ? parsed.roles
          .map((r) => normalizeRole(r))
          .filter((r): r is RoleDef => r !== null)
      : [];
    if (roles.length === 0) return { version: 1, roles: DEFAULT_ROLES };
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      roles
    };
  } catch {
    return { version: 1, roles: DEFAULT_ROLES };
  }
}

function normalizeRole(raw: unknown): RoleDef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { id?: unknown; name?: unknown; note?: unknown };
  if (typeof r.id !== "string" || !ID_RE.test(r.id)) return null;
  if (typeof r.name !== "string" || r.name.trim().length === 0) return null;
  const out: RoleDef = { id: r.id, name: r.name.trim() };
  if (typeof r.note === "string" && r.note.trim().length > 0) out.note = r.note.trim();
  return out;
}

/** 校验一组 role id 是否都在 registry 中。返回非法 id 列表(空数组 = 全合法)。 */
export async function findInvalidRoleIds(ids: readonly string[]): Promise<string[]> {
  const registry = await loadRolesRegistry();
  const valid = new Set(registry.roles.map((r) => r.id));
  return ids.filter((id) => !valid.has(id));
}
