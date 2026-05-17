import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { ProductMeta } from "@atlas/shared";
import { dataPath } from "./fileReader";
import type { AggregateFeature, AggregateModule, AggregateParsed } from "./aggregateMdParser";
import { AggregateValidationError } from "./aggregateMdParser";
import { blankStatusMarkdown } from "./productScaffold";

export class AggregateImportConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AggregateImportConflict";
  }
}

/**
 * 接收 parser 输出,落盘到 data/products/<product_id>/。
 *
 * 顺序:校验目录不存在 → 创建 product 根 + meta.yml + STATUS.md → 每个模块的目录 +
 * MODULE.md + features/<id>.md。任何一步失败回滚已创建文件(尽力)。
 *
 * 返回创建的产品 id。
 */
export async function importAggregate(parsed: AggregateParsed): Promise<string> {
  const productDir = dataPath("products", parsed.product.id);
  // 409 check
  try {
    await fs.access(productDir);
    throw new AggregateImportConflict(`产品目录已存在: ${parsed.product.id}`);
  } catch (err) {
    if (err instanceof AggregateImportConflict) throw err;
    // ENOENT — 继续
  }

  const today = new Date().toISOString().slice(0, 10);

  // 把所有要写的文件先准备好,最后批量写,降低部分写入概率
  const filesToWrite: Array<{ p: string; content: string }> = [];

  // meta.yml
  const meta: ProductMeta = {
    id: parsed.product.id,
    name: parsed.product.name,
    theme: "erp",
    status: "planning",
    tech_stack: [],
    source_path: null,
    deploy_url: null,
    created_at: today,
    tagline: parsed.product.description.split("\n")[0]?.slice(0, 120) || null,
    repo: null
  };
  filesToWrite.push({
    p: path.join(productDir, "meta.yml"),
    content: YAML.stringify(meta)
  });

  // STATUS.md (最小骨架 + 用户提供的产品概述写到"当前状态"段后面)
  filesToWrite.push({
    p: path.join(productDir, "STATUS.md"),
    content: composeStatusMd(today, parsed.product.description)
  });

  // 模块 + 功能点
  for (const mod of parsed.modules) {
    const modDir = path.join(productDir, "modules", mod.id);
    filesToWrite.push({
      p: path.join(modDir, "MODULE.md"),
      content: composeModuleMd(mod)
    });
    for (const feat of mod.features) {
      filesToWrite.push({
        p: path.join(modDir, "features", `${feat.id}.md`),
        content: composeFeatureMd(feat, mod.id, today)
      });
    }
  }

  // 写入
  await fs.mkdir(productDir, { recursive: true });
  try {
    for (const f of filesToWrite) {
      await fs.mkdir(path.dirname(f.p), { recursive: true });
      await fs.writeFile(f.p, f.content, "utf8");
    }
  } catch (err) {
    // 回滚: 尝试删整个 product 目录
    await fs.rm(productDir, { recursive: true, force: true }).catch(() => {
      /* ignore */
    });
    throw err;
  }

  return parsed.product.id;
}

function composeStatusMd(today: string, productDescription: string): string {
  const base = blankStatusMarkdown(today);
  if (!productDescription.trim()) return base;
  // 把"立项中。"替换为产品概述前两段(最多)
  const desc = productDescription.trim();
  return base.replace(/# 当前状态\n\n立项中。/, `# 当前状态\n\n${desc}`);
}

function composeModuleMd(mod: AggregateModule): string {
  const fm: Record<string, unknown> = {
    id: mod.id,
    name: mod.name,
    role: mod.role,
    color: mod.color
  };
  if (mod.order !== null) fm.order = mod.order;
  const yaml = YAML.stringify(fm).trimEnd();
  return `---
${yaml}
---

# ${mod.name}

## 职责
${mod.role_desc || ""}
`;
}

function composeFeatureMd(
  feat: AggregateFeature,
  moduleId: string,
  today: string
): string {
  const fm: Record<string, unknown> = {
    id: feat.id,
    name: feat.name,
    module: moduleId,
    created_at: today
  };
  if (feat.module_group) fm.module_group = feat.module_group;
  if (feat.roles && feat.roles.length > 0) fm.roles = feat.roles;
  if (feat.entities_touched && feat.entities_touched.length > 0) {
    fm.entities_touched = feat.entities_touched;
  }
  if (feat.ownership) fm.ownership = feat.ownership;
  const yaml = YAML.stringify(fm).trimEnd();
  return `---
${yaml}
---

# ${feat.name}

## 描述
${feat.description || ""}

## 线索池

### Pending

### Resolved

## 反馈池

\`\`\`yaml
[]
\`\`\`
`;
}

export { AggregateValidationError };
