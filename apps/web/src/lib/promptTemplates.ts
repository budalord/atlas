import type { FeatureSpec, Product } from "../types";

const SPEC_REF = "工作约定:AGENTS.md(canonical) 或 .claude/skills/alts/SKILL.md。";

/**
 * 产品级指令:把整个产品的当前状态摘要给 agent,触发"产品状态维护"流程。
 */
export function productLevelPrompt(product: Product) {
  const features = product.features.length
    ? product.features
        .map((f) => `  - ${f.id} ${f.description} [${f.status || "?"}, ${f.priority || "?"}] ${f.endpoint ? `· ${f.endpoint}` : ""}`)
        .join("\n")
    : "  (暂无功能点)";

  const todos = product.todos.length
    ? product.todos.map((t) => `  - ${t.done ? "[x]" : "[ ]"} ${t.text}`).join("\n")
    : "  (暂无)";

  return `# 产品维护:${product.meta.name} (${product.id})

状态: ${product.meta.status} · 主题: ${product.meta.theme}
源路径: ${product.meta.source_path}
${product.meta.tagline ? `定位: ${product.meta.tagline}\n` : ""}
功能点(${product.features.length}):
${features}

待办:
${todos}

请描述你想做什么。按 AGENTS.md "产品状态维护" 工作流处理:最小修改 STATUS.md / meta.yml,保持 6 列功能表,完成后更新 last_updated。

相关文件:
- data/products/${product.id}/STATUS.md
- data/products/${product.id}/meta.yml
- ${SPEC_REF}`;
}

/**
 * 单功能点指令:把这条功能的全部上下文塞进去,让 agent 直接能动手。
 */
export function featureLevelPrompt(productId: string, feature: FeatureSpec) {
  const lines = [
    `# 功能点维护:${productId} · ${feature.id}`,
    "",
    `**${feature.description}**`,
    "",
    `- 状态: ${feature.status || "—"}`,
    `- 优先级: ${feature.priority || "—"}`,
    `- 接口: ${feature.endpoint || "—"}`,
    `- 备注: ${feature.notes || "—"}`,
    "",
    "请描述你想做什么(改动方向、新状态、补充备注等)。按 AGENTS.md \"产品状态维护\" 流程处理,完成后同步更新 STATUS.md(此功能行 + last_updated)。",
    "",
    "相关文件:",
    `- data/products/${productId}/STATUS.md`,
    `- ${SPEC_REF}`
  ];
  return lines.join("\n");
}

/**
 * 分组级指令:不复制 N 份单条模板,而是给 agent 一组功能的列表,
 * 让用户用一句话指令覆盖整组。
 */
export function groupLevelPrompt(productId: string, groupLabel: string, features: FeatureSpec[]) {
  const rows = features
    .map((f) => `- ${f.id} ${f.description} [${f.status || "?"}, ${f.priority || "?"}]${f.notes ? ` — ${f.notes}` : ""}`)
    .join("\n");

  return `# 批量维护:${productId} · ${groupLabel}

涉及 ${features.length} 个功能点:
${rows}

请描述你想做什么(可以是统一的状态变更、批量备注更新、整组重构说明等)。按 AGENTS.md "产品状态维护" 流程处理,完成后同步更新 STATUS.md(涉及行 + last_updated)。

相关文件:
- data/products/${productId}/STATUS.md
- ${SPEC_REF}`;
}
