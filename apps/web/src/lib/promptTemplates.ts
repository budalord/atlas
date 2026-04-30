import type { FeatureSpec, Product } from "../types";

export function productLevelPrompt(product: Product) {
  return `你正在维护 Atlas 产品规格。

产品: ${product.meta.name} (${product.id})
状态: ${product.meta.status}
技术栈: ${product.meta.tech_stack.join(", ")}
源路径: ${product.meta.source_path}

请阅读下面的 STATUS.md 内容，基于现有结构给出最小必要修改，不要引入数据库、认证或部署配置。

${product.statusMarkdown}`;
}

export function featureLevelPrompt(productId: string, feature: FeatureSpec) {
  return `请修改 ${productId} 的功能点 ${feature.id}(${feature.description}):
[在此填写你的修改要求]

相关文件:data/products/${productId}/STATUS.md
完成后请同步更新 STATUS.md 中此功能点的状态。`;
}
