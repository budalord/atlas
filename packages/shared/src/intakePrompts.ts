import type { ProductTheme } from "./types";

interface DiscoverParams {
  id: string;
  name: string;
  sourcePath: string;
  theme: ProductTheme | string;
  atlasPath: string;
}

interface InterviewParams {
  id: string;
  atlasPath: string;
}

interface FinalizeParams {
  id: string;
  atlasPath: string;
}

export function intakeDiscoverPrompt(params: DiscoverParams): string {
  const { id, name, sourcePath, theme, atlasPath } = params;
  return `你是 Atlas 录入助手。任务是探索一个项目并产出原始观察文档。

项目信息:
- ID: ${id}
- 名称: ${name}
- 路径: ${sourcePath}
- 主题: ${theme}

请执行:
1. cd 到 ${sourcePath}
2. 读取根目录、package.json / go.mod / requirements.txt 等
3. 识别技术栈(框架、语言、关键依赖)
4. 扫描页面/路由相关目录(pages/、src/pages/、app/、router 配置等)
5. 列出所有页面/路由 + 一句话描述
6. 识别核心目录结构和模块划分
7. grep 对外 API 调用(request、fetch、axios、wx.request 等)
8. 检查 README、docs/、设计文档

输出到 ${atlasPath}/data/products/${id}/DISCOVERY.md,使用以下结构:

# ${name} 项目发现

## 技术栈
- 语言:
- 框架:
- 关键依赖:

## 页面/路由清单
- 路径 → 文件 → 一句话描述

## 模块划分
(目录结构 + 职责)

## 对外 API 调用
- 端点 → 调用位置(文件:行号)

## 项目文档
- README:有/无,关键内容摘要
- 其他文档:

## 我注意到的特殊点
- 任何让你觉得"这个项目特殊"或"需要业务方确认"的观察

完成后告知用户进入阶段 2。不要修改原项目任何代码,只读不写。`;
}

export function intakeInterviewPrompt(params: InterviewParams): string {
  const { id, atlasPath } = params;
  return `基于 ${atlasPath}/data/products/${id}/DISCOVERY.md,生成针对用户的访谈问题。

问题应聚焦于代码看不出来的业务意图:
- 目标用户是谁?
- 核心业务流程是什么?
- 哪些功能是"上线了但快废弃"?哪些是"刚开始做但还没暴露"?
- 哪些 API 可能被其他产品调用?(用于识别跨产品契约)
- 当前最大的卡点或技术债是什么?
- 是否对接了 AI?用什么模型?解决什么问题?
- 对这个产品 status 的判断:in-progress / paused / live / archived?

输出到 ${atlasPath}/data/products/${id}/INTERVIEW.md,每个问题用以下格式:

## 问题 1: <问题文本>
**回答**: [ ] 待回答

不超过 10 个问题。挑最重要的、代码无法回答的。
完成后告知用户回答 INTERVIEW.md 后进入阶段 3。`;
}

export function intakeFinalizePrompt(params: FinalizeParams): string {
  const { id, atlasPath } = params;
  return `基于 ${atlasPath}/data/products/${id}/DISCOVERY.md 和 INTERVIEW.md(已被用户填写),完成最终录入:

1. 重写 ${atlasPath}/data/products/${id}/STATUS.md,完整结构包括:
   - frontmatter (last_updated)
   - # 当前状态
   - ## 待办
   - ## 阻塞
   - ## 功能点(完整表格,从 DISCOVERY 提取并参考 INTERVIEW 调整)
   - ## 流程图(Mermaid,反映核心业务流程)

2. 更新 meta.yml:
   - tech_stack 填实际技术栈
   - status 根据 INTERVIEW 答案设置
   - tagline 写一句话定位

3. 识别跨产品 API:
   如果在 INTERVIEW 中用户指出某些 API 会被其他产品调用,
   在 ${atlasPath}/data/contracts/ 下创建契约草稿(<provider>-<consumer>-<topic>.md)

4. 在产品目录下输出 SUMMARY.md:
   - 你做了什么
   - 哪些字段是从代码推断
   - 哪些字段是从用户答案直接采用
   - 任何你不确定、需要用户后续确认的地方

5. 不要删除 DISCOVERY.md 和 INTERVIEW.md,它们作为历史保留。`;
}

export function intakePlaceholderStatus(name: string): string {
  return `---
last_updated: ${new Date().toISOString().slice(0, 10)}
---

# 当前状态

${name} 录入中。请按 Intake 三阶段流程完成录入,本文件会在阶段 3 被覆盖。

## 待办
- [ ] 阶段 1:发现
- [ ] 阶段 2:访谈
- [ ] 阶段 3:沉淀

## 阻塞
- 无

## 功能点

| ID | 描述 | 状态 | 优先级 | 接口 | 备注 |
|----|------|------|--------|------|------|
`;
}

export function intakeMarkdown(id: string): string {
  return `# Intake: ${id}

此文件是 Atlas Intake Module 自动创建的录入指引。三阶段完成后,
它会被自动重命名为 INTAKE.archive.md 作为历史保留。

## 阶段 1:发现 (Discover)
让 Claude Code 探索项目代码,产出 DISCOVERY.md。

## 阶段 2:访谈 (Interview)
基于 DISCOVERY.md,生成 INTERVIEW.md 中的问题。用户回答后进入阶段 3。

## 阶段 3:沉淀 (Finalize)
基于 DISCOVERY + INTERVIEW,生成最终的 STATUS.md。
`;
}
