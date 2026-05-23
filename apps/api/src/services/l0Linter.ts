import type { L0Violation, L0ViolationsData } from "@atlas/shared";
import { loadEntities, loadFeatures, loadModules } from "./entityLoader";
import { loadRolesRegistry } from "./rolesRegistry";
import { loadActors } from "./actorLoader";
import { loadCapabilities } from "./capabilityLoader";
import { loadUseCases } from "./usecaseLoader";
import { loadDerivedEntities } from "./derivedEntityLoader";

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

  // v0.1: 加载 actors / capabilities / usecases / entities 用于引用完整性检查(规则 6 + 8)
  // entity_ids 解析时同时认 entities/(声明区)和 derived/entities/(派生区) — rev3 把派生视为一等公民
  const [actors, capabilities, usecases, entities, derivedEntities] = await Promise.all([
    loadActors(productId),
    loadCapabilities(productId),
    loadUseCases(productId),
    loadEntities(productId),
    loadDerivedEntities(productId)
  ]);
  const validActorIds = new Set(actors.map((a) => a.id));
  const validCapabilityIds = new Set(capabilities.map((c) => c.id));
  const validEntityIds = new Set<string>([
    ...entities.map((e) => e.id),
    ...derivedEntities.map((e) => e.name)
  ]);

  // 收集所有 functions 用于规则 8 (capability 粒度) + 规则 1 (id 全局唯一)
  const allFunctions: { fn: import("@atlas/shared").FeaturePoint; mod: string }[] = [];
  const fnIdToSources = new Map<string, string[]>();

  for (const mod of modules) {
    const features = await loadFeatures(productId, mod.name);
    const validGroupIds = new Set((mod.groups ?? []).map((g) => g.id));
    const hasGroups = validGroupIds.size > 0;
    for (const f of features) {
      allFunctions.push({ fn: f, mod: mod.name });
      const src = `data/products/${productId}/modules/${mod.name}/features/${f.id}.md`;
      if (!fnIdToSources.has(f.id)) fnIdToSources.set(f.id, []);
      fnIdToSources.get(f.id)!.push(src);
    }

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

      // v0.1 规则 6a: function 缺 capability_id (软兼容警告)
      if (!f.capability_id) {
        violations.push({
          category: "missing-frontmatter",
          message: "frontmatter 缺 capability_id (v0.1 必填, 软兼容)",
          source,
          severity: "warn",
          suggestion: "frontmatter 加 `capability_id: <existing-capability-id>` 或新建对应 capability.md"
        });
      } else if (!validCapabilityIds.has(f.capability_id)) {
        // v0.1 规则 6a: function 引用不存在的 capability_id
        violations.push({
          category: "invalid-reference",
          message: `capability_id "${f.capability_id}" 引用不存在的 capability`,
          source,
          severity: "warn",
          suggestion: `在 capabilities/ 下创建 ${f.capability_id}.md, 或改 function.capability_id 为已存在的 id`
        });
      }

      // v0.1 规则 6: function.actor_ids 引用不存在的 actor (旧 roles 字段已 alias)
      const fnActorIds = f.actor_ids ?? f.roles ?? [];
      for (const aid of fnActorIds) {
        if (!validActorIds.has(aid)) {
          // 注意: roles.yml 全局池里可能有, 但项目级 actors/ 没有 — 仍报警, 提示项目级补
          violations.push({
            category: "invalid-reference",
            message: `actor_ids "${aid}" 在项目级 actors/ 中找不到`,
            source,
            severity: "warn",
            suggestion: `在 actors/${aid}.md 创建 actor 定义`
          });
        }
      }
    }
  }

  // v0.1 规则 6b: capability 引用不存在的 actor_id
  for (const cap of capabilities) {
    const capSource = `data/products/${productId}/capabilities/${cap.id}.md`;
    for (const aid of cap.actor_ids) {
      if (!validActorIds.has(aid)) {
        violations.push({
          category: "invalid-reference",
          message: `actor_ids "${aid}" 在项目级 actors/ 中找不到`,
          source: capSource,
          severity: "warn"
        });
      }
    }
    // v0.1 规则 6c: capability 引用不存在的 entity_id
    for (const eid of cap.entity_ids) {
      if (!validEntityIds.has(eid)) {
        violations.push({
          category: "invalid-reference",
          message: `entity_ids "${eid}" 在 entities/ 或 derived/entities/ 中找不到`,
          source: capSource,
          severity: "warn"
        });
      }
    }
    // v0.1 规则 8: capability 粒度 (3-10 function 健康)
    const fnCount = allFunctions.filter(({ fn }) => fn.capability_id === cap.id).length;
    if (fnCount === 0) {
      violations.push({
        category: "format",
        message: `capability "${cap.id}" 下 0 个 function (空 capability)`,
        source: capSource,
        severity: "warn",
        suggestion: "删除该 capability, 或补充 function, 或改 status=draft"
      });
    } else if (fnCount < 3) {
      violations.push({
        category: "format",
        message: `capability "${cap.id}" 下仅 ${fnCount} 个 function (规则 8 建议 3-10 个)`,
        source: capSource,
        severity: "warn",
        suggestion: "合并到相近 capability, 或确认是有意拆细"
      });
    } else if (fnCount > 10) {
      violations.push({
        category: "format",
        message: `capability "${cap.id}" 下 ${fnCount} 个 function (规则 8 建议 ≤ 10 个)`,
        source: capSource,
        severity: "warn",
        suggestion: "按业务子域 / actor 主导差异拆分"
      });
    }
  }

  // v0.1 规则 1: function.id 产品内全局唯一
  for (const [fid, sources] of fnIdToSources.entries()) {
    if (sources.length > 1) {
      for (const src of sources) {
        violations.push({
          category: "naming",
          message: `function.id "${fid}" 在产品内重复 (出现于 ${sources.length} 个 .md 文件)`,
          source: src,
          severity: "error",
          suggestion: "function.id 必须产品内全局唯一 (规则 1), 重命名其中一个"
        });
      }
    }
  }

  // v0.1 规则 6d: usecase 引用不存在的 function_id / actor_id
  const validFunctionIds = new Set(allFunctions.map(({ fn }) => fn.id));
  for (const uc of usecases) {
    const ucSource = `data/products/${productId}/modules/${uc.module}/usecases/${uc.id}.md`;
    if (!validFunctionIds.has(uc.function_id)) {
      violations.push({
        category: "invalid-reference",
        message: `function_id "${uc.function_id}" 引用不存在的 function`,
        source: ucSource,
        severity: "warn"
      });
    }
    if (!validActorIds.has(uc.actor_id)) {
      violations.push({
        category: "invalid-reference",
        message: `actor_id "${uc.actor_id}" 在 actors/ 中找不到`,
        source: ucSource,
        severity: "warn"
      });
    }
  }

  return {
    exists: true,
    total: violations.length,
    violations,
    generated_at: new Date().toISOString()
  };
}
