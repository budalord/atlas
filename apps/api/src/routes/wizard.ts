import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { Router } from "express";
import type {
  Actor,
  ActorType,
  Capability,
  CapabilityPriority,
  CapabilityStatus
} from "@atlas/shared";
import { dataPath } from "../services/fileReader";
import { writeActor } from "../services/actorLoader";
import { writeCapability } from "../services/capabilityLoader";
import { bumpDataVersion, getDataVersion } from "../services/watcher";

const ID_RE = /^[a-z][a-z0-9-]*$/;

export const wizardRouter = Router();

interface WizardPayload {
  product: {
    id: string;
    name: string;
    theme?: string;
    tagline?: string;
    description?: string;
    in_scope?: string[];
    out_of_scope?: string[];
  };
  actors: Array<{
    id: string;
    name: string;
    type: ActorType;
    responsibilities?: string;
    code?: string;
  }>;
  capabilities: Array<{
    id: string;
    name: string;
    domain: string;
    value_statement?: string;
    actor_ids: string[];
    entity_ids?: string[];
    priority?: CapabilityPriority;
  }>;
  functions: Array<{
    id: string;
    name: string;
    module: string;
    capability_id: string;
    actor_ids: string[];
    entities_touched?: string[];
  }>;
  modules: Array<{ id: string; name: string; order?: number }>;
}

/**
 * POST /api/products/wizard/init — 一次性落盘 Wizard 输出。
 *
 * 落盘内容:
 *   - data/products/<id>/meta.yml
 *   - data/products/<id>/STATUS.md (最小)
 *   - data/products/<id>/actors/*.md
 *   - data/products/<id>/capabilities/*.md
 *   - data/products/<id>/modules/<m>/MODULE.md
 *   - data/products/<id>/modules/<m>/features/*.md (function = feature 物理形态)
 *
 * 校验:
 *   - product.id kebab-case + 不能与已有产品冲突
 *   - actor.id / capability.id / function.id 都 kebab-case
 *   - function.capability_id 必须引用 capabilities 中存在的 id
 *   - function.actor_ids 必须引用 actors 中存在的 id
 *   - function.module 必须引用 modules 中存在的 id
 */
wizardRouter.post("/init", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as WizardPayload;
    const product = body.product;

    if (!product || !product.id || !ID_RE.test(product.id)) {
      res.status(400).json({ error: "product.id 必须 kebab-case" });
      return;
    }
    if (!product.name) {
      res.status(400).json({ error: "product.name 必填" });
      return;
    }

    // 防覆盖已有产品
    const productRoot = dataPath("products", product.id);
    try {
      await fs.access(productRoot);
      res.status(409).json({ error: `产品 ${product.id} 已存在` });
      return;
    } catch {
      // not exists — OK
    }

    const actors = body.actors ?? [];
    const capabilities = body.capabilities ?? [];
    const functions = body.functions ?? [];
    const modules = body.modules ?? [];

    // 引用完整性校验
    const actorIds = new Set(actors.map((a) => a.id));
    const capabilityIds = new Set(capabilities.map((c) => c.id));
    const moduleIds = new Set(modules.map((m) => m.id));

    for (const f of functions) {
      if (!ID_RE.test(f.id)) {
        res.status(400).json({ error: `function.id "${f.id}" 不是 kebab-case` });
        return;
      }
      if (!moduleIds.has(f.module)) {
        res.status(400).json({ error: `function "${f.id}" 引用不存在的 module: ${f.module}` });
        return;
      }
      if (!capabilityIds.has(f.capability_id)) {
        res.status(400).json({
          error: `function "${f.id}" 引用不存在的 capability_id: ${f.capability_id}`
        });
        return;
      }
      for (const aid of f.actor_ids) {
        if (!actorIds.has(aid)) {
          res.status(400).json({
            error: `function "${f.id}" 引用不存在的 actor_id: ${aid}`
          });
          return;
        }
      }
    }
    for (const c of capabilities) {
      if (!ID_RE.test(c.id)) {
        res.status(400).json({ error: `capability.id "${c.id}" 不是 kebab-case` });
        return;
      }
      for (const aid of c.actor_ids) {
        if (!actorIds.has(aid)) {
          res
            .status(400)
            .json({ error: `capability "${c.id}" 引用不存在的 actor_id: ${aid}` });
          return;
        }
      }
    }
    for (const a of actors) {
      if (!ID_RE.test(a.id)) {
        res.status(400).json({ error: `actor.id "${a.id}" 不是 kebab-case` });
        return;
      }
    }
    for (const m of modules) {
      if (!ID_RE.test(m.id)) {
        res.status(400).json({ error: `module.id "${m.id}" 不是 kebab-case` });
        return;
      }
    }

    // === 实际落盘 ===
    await fs.mkdir(productRoot, { recursive: true });

    // meta.yml
    const metaObj: Record<string, unknown> = {
      id: product.id,
      name: product.name,
      theme: product.theme ?? "custom",
      status: "planning",
      tech_stack: [] as string[]
    };
    if (product.tagline) metaObj.tagline = product.tagline;
    if (product.description) metaObj.description = product.description;
    await fs.writeFile(
      path.join(productRoot, "meta.yml"),
      YAML.stringify(metaObj),
      "utf8"
    );

    // STATUS.md (最小)
    const today = new Date().toISOString().slice(0, 10);
    const scopeBlock =
      (product.in_scope && product.in_scope.length > 0
        ? `## 项目范围 (in scope)\n${product.in_scope.map((s) => `- ${s}`).join("\n")}\n\n`
        : "") +
      (product.out_of_scope && product.out_of_scope.length > 0
        ? `## 不在范围 (out of scope)\n${product.out_of_scope.map((s) => `- ${s}`).join("\n")}\n\n`
        : "");
    const statusText = `---
last_updated: ${today}
---

# STATUS

立项 Wizard 一次性建立的产品。

${scopeBlock}## Wizard 输出概览
- ${actors.length} actor
- ${capabilities.length} capability
- ${functions.length} function
- ${modules.length} module
`;
    await fs.writeFile(path.join(productRoot, "STATUS.md"), statusText, "utf8");

    // actors/
    for (const a of actors) {
      const actor: Actor = {
        id: a.id,
        name: a.name,
        type: a.type,
        source: "user_input",
        confirmed: true,
        ...(a.code ? { code: a.code } : {}),
        ...(a.responsibilities ? { responsibilities: a.responsibilities } : {}),
        body: ""
      };
      await writeActor(product.id, actor);
    }

    // capabilities/
    for (const c of capabilities) {
      const cap: Capability = {
        id: c.id,
        name: c.name,
        domain: c.domain,
        value_statement: c.value_statement ?? "",
        actor_ids: c.actor_ids,
        entity_ids: c.entity_ids ?? [],
        priority: c.priority ?? "P1",
        status: "draft" as CapabilityStatus,
        source: "user_input",
        confirmed: false,
        body: ""
      };
      await writeCapability(product.id, cap);
    }

    // modules/<m>/MODULE.md
    for (const m of modules) {
      const moduleDir = path.join(productRoot, "modules", m.id);
      await fs.mkdir(moduleDir, { recursive: true });
      const moduleFm: Record<string, unknown> = { id: m.id, name: m.name };
      if (m.order !== undefined) moduleFm.order = m.order;
      const moduleText = `---\n${YAML.stringify(moduleFm).trim()}\n---\n\n# ${m.name}\n`;
      await fs.writeFile(path.join(moduleDir, "MODULE.md"), moduleText, "utf8");
    }

    // functions = feature.md
    for (const f of functions) {
      const featuresDir = path.join(productRoot, "modules", f.module, "features");
      await fs.mkdir(featuresDir, { recursive: true });
      const fm: Record<string, unknown> = {
        id: f.id,
        name: f.name,
        module: f.module,
        capability_id: f.capability_id,
        actor_ids: f.actor_ids,
        created_at: today
      };
      if (f.entities_touched && f.entities_touched.length > 0) {
        fm.entities_touched = f.entities_touched;
      }
      const fnText = `---\n${YAML.stringify(fm).trim()}\n---\n\n# ${f.name}\n\n## 描述\n\n(待补)\n\n## 反馈池\n\n\`\`\`yaml\n[]\n\`\`\`\n`;
      await fs.writeFile(path.join(featuresDir, `${f.id}.md`), fnText, "utf8");
    }

    bumpDataVersion(`products/${product.id}/meta.yml`);

    res.status(201).json({
      data: {
        product_id: product.id,
        counts: {
          actors: actors.length,
          capabilities: capabilities.length,
          functions: functions.length,
          modules: modules.length
        }
      },
      version: getDataVersion()
    });
  } catch (error) {
    next(error);
  }
});
