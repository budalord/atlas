import { promises as fs } from "node:fs";
import type { ProductMeta } from "@atlas/shared";
import { dataPath } from "./fileReader";

/**
 * 产品领域画像 — 注入到**所有** Atlas agent 的 prompt 头部(经 header())。
 *
 * 目的: 让每个 agent 生成/修订时都带着"这是什么行业的什么系统"的领域常识,
 * 主动补全输入流程未显式写出、但这类系统理应具备的标准细节(标准字段 / 实体关系 /
 * 状态流转 / 权限边界), 从源头解决"薄"。
 *
 * 两层:
 *   - 事实层: meta.yml 的 business_domain / organization / campuses / ... (立项时声明)
 *   - 约定层: 可选 data/products/<id>/PROFILE.md(行业标准约定 + 关键实体常识, PM 维护)
 */
export async function buildDomainContext(
  meta: ProductMeta | null,
  productId: string
): Promise<string> {
  const facts: string[] = [];
  if (meta) {
    facts.push(`- 产品: ${meta.name}(theme: ${meta.theme})`);
    if (meta.business_domain) facts.push(`- 业务领域: ${meta.business_domain}`);
    if (meta.organization) facts.push(`- 业主机构: ${meta.organization}`);
    if (meta.campuses && meta.campuses.length > 0) facts.push(`- 校区/站点: ${meta.campuses.join(" / ")}`);
    if (meta.decision_makers && meta.decision_makers.length > 0)
      facts.push(`- 决策方: ${meta.decision_makers.join(" / ")}`);
    if (meta.roadmap_phase) facts.push(`- 当前阶段: ${meta.roadmap_phase}`);
    if (meta.tech_stack && meta.tech_stack.length > 0) facts.push(`- 技术栈: ${meta.tech_stack.join(" / ")}`);
    if (meta.tagline) facts.push(`- 一句话: ${meta.tagline}`);
    if (meta.description) facts.push(`- 描述: ${meta.description}`);
  }

  let profile = "";
  try {
    profile = (await fs.readFile(dataPath("products", productId, "PROFILE.md"), "utf8")).trim();
  } catch {
    /* 无 PROFILE.md — 仅用 meta 事实 + 通用领域增强指令 */
  }

  return [
    "## 产品领域画像(所有 Agent 必读)",
    "",
    facts.length > 0 ? facts.join("\n") : "(meta.yml 未声明领域事实)",
    profile ? `\n### 领域约定与关键常识(PROFILE.md)\n${profile}` : "",
    "",
    "**领域增强原则(强约束)**: 你在为上述【行业 + 系统类型】工作。生成 / 修订时, 基于该领域的常识, " +
      "主动补全输入流程未显式写出、但这类系统理应具备的标准细节 —— 标准字段(金额 / 状态 / 时间戳 / 操作人 等)、" +
      "标准实体关系、标准状态流转、常见权限边界。**不要只照搬稀疏输入而留薄**。" +
      "但只补该领域真实成立的, **不发明与领域无关的东西**;拿不准的标 [TBD] 而非瞎编。"
  ].join("\n");
}
