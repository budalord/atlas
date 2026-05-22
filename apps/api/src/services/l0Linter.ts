import type { L0Violation, L0ViolationsData } from "@atlas/shared";
import { loadFeatures, loadModules } from "./entityLoader";
import { loadRolesRegistry } from "./rolesRegistry";

/**
 * 机械化 L0 违规检测。
 *
 * 检查规则(扩展时加 case):
 *   - feature.id 必须 kebab-case
 *   - feature.roles 中 id 必须在 RolesRegistry
 *   - feature.entities_touched 名字必须 PascalCase
 *   - feature.module_group 若 MODULE.md 声明了 groups,必须引用其中一项
 *   - feature.ownership 若有值,必须是合法 enum 或 "follows:<Entity>" 形态
 *
 * 不在本机械化范围(留给派生 Agent prompt-driven lint):
 *   - feature.description 是否符合"关键字段 / 关键约束 / 触发后续"三段写作约定
 *   - L0 禁忌的违反(需要语义判断)
 */
export async function runL0Lint(productId: string): Promise<L0ViolationsData> {
  const violations: L0Violation[] = [];
  const modules = await loadModules(productId);
  const registry = await loadRolesRegistry();
  const validRoleIds = new Set(registry.roles.map((r) => r.id));

  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    const validGroupIds = new Set((mod.groups ?? []).map((g) => g.id));
    const hasGroups = validGroupIds.size > 0;

    for (const f of features) {
      const source = `data/products/${productId}/modules/${mod.name}/features/${f.id}.md`;

      // 1. feature.id kebab-case
      if (!/^[a-z][a-z0-9-]*$/.test(f.id)) {
        violations.push({
          category: "naming",
          message: `feature.id "${f.id}" 不是 kebab-case`,
          source,
          severity: "error",
          suggestion: "改为全小写 + 连字符(如 student-intake)"
        });
      }

      // 2. roles 引用必须在 RolesRegistry
      if (f.roles && f.roles.length > 0) {
        for (const rid of f.roles) {
          if (!validRoleIds.has(rid)) {
            violations.push({
              category: "invalid-reference",
              message: `roles: "${rid}" 不在 data/roles.yml 注册表中`,
              source,
              severity: "error",
              suggestion: `加入 roles.yml,或改为已注册的 role id`
            });
          }
        }
      }

      // 3. entities_touched 必须 PascalCase
      if (f.entities_touched && f.entities_touched.length > 0) {
        for (const ent of f.entities_touched) {
          if (!/^[A-Z][A-Za-z0-9]*$/.test(ent)) {
            violations.push({
              category: "naming",
              message: `entities_touched: "${ent}" 不是 PascalCase`,
              source,
              severity: "warn",
              suggestion: "改为 PascalCase(如 Student / Order / Product)"
            });
          }
        }
      }

      // 4. module_group 引用
      if (f.module_group) {
        if (hasGroups && !validGroupIds.has(f.module_group)) {
          violations.push({
            category: "invalid-reference",
            message: `module_group: "${f.module_group}" 不在 MODULE.md groups 声明中`,
            source,
            severity: "warn",
            suggestion: `加入 modules/${mod.name}/MODULE.md frontmatter.groups[],或改为已声明的 group id`
          });
        }
      }

      // 5. ownership 合法 enum
      if (f.ownership) {
        const owned = f.ownership.trim();
        const isOrg = owned === "org";
        const isCampus = owned === "campus";
        const isShared = owned === "shared";
        const isFollows = /^follows:[A-Z][A-Za-z0-9]*$/.test(owned);
        if (!isOrg && !isCampus && !isShared && !isFollows) {
          violations.push({
            category: "format",
            message: `ownership: "${owned}" 不是合法值`,
            source,
            severity: "warn",
            suggestion: "合法值:org / campus / shared / follows:<EntityName>"
          });
        }
      }

      // 6. 主 frontmatter 必填(parser 已挡空 id/name 但 module / created_at 缺失会过)
      if (!f.module || f.module.length === 0) {
        violations.push({
          category: "missing-frontmatter",
          message: "frontmatter 缺 module 字段",
          source,
          severity: "error"
        });
      }
      if (!f.created_at || f.created_at.length === 0) {
        violations.push({
          category: "missing-frontmatter",
          message: "frontmatter 缺 created_at 字段",
          source,
          severity: "warn"
        });
      }
    }
  }

  return {
    exists: true,
    total: violations.length,
    violations,
    generated_at: new Date().toISOString()
  };
}
