# Extension Guide

## 模块 3: 契约管理

当前 MVP 只实现契约列表和 markdown 查看。未来扩展到完整版时，可以在 `apps/api/src/routes/contracts.ts` 增加 provider/consumer 过滤、契约状态筛选和引用校验；前端可在 `ContractList.tsx` 中增加按产品分组、搜索和契约详情侧栏。关联图不要直接塞进列表组件，应单独增加图组件，并从 API 返回结构化节点和边。

## 模块 4: 双轨设计区

当前仅保留 `data/designs/`、`apps/api/src/routes/designs.ts` 和 `DesignTrack.tsx`。未来扩展时，建议先定义 `data/designs/<product-id>/` 目录，分别存放 PRD、原型说明和设计决策 markdown。API 只负责读取结构化索引，前端再增加设计轨道视图。不要在 MVP 的产品详情里混入设计逻辑。

## 模块 5: Agent 工作区

当前实现复制指令和 `data/agents/CLAUDE.md` 中心。`AgentInbox.tsx` 后续可扩展为任务收件箱，数据源建议放在 `data/agents/inbox/`，每个任务一个 markdown 文件，frontmatter 记录目标产品、状态和创建时间。`promptTemplates.ts` 后续可沉淀多种可复制模板，但模板应保持纯文本函数，不直接调用模型。

## 模块 6: AI 触点管理

当前仅保留 `AICatalog.tsx` 和 `apps/api/src/routes/ai.ts`。未来如果要记录 AI 功能点，建议新增 `data/ai-touchpoints/`，每个触点记录所属产品、输入、输出、风险和依赖模型。不要在早期把它与健康度计算绑定。

## 模块 7: 今日聚焦和导出

MVP 明确不实现今日聚焦和导出。未来可从产品 `STATUS.md` 的待办、阻塞和优先级聚合出 focus feed。导出可以作为只读转换层，从 API 读取现有 markdown，生成 PDF 或静态 HTML，不应改变 `data/` 源格式。

## 模块 7.1: 待办看板

当前仅保留 `TodoBoard.tsx` 占位卡片，挂在主页面入口。未来填充时，应在 API 层新增聚合端点（如 `/api/focus`），从已加载的产品 `STATUS.md` 待办段中按产品 + 优先级合并出看板数据，前端按"今日 / 阻塞 / 待办"列展示。看板只读，勾选完成应通过"复制指令"流转到 agent 修改源文件，不要直接写回 `data/`。

## 模块 8: 数据源和文件监听

当前 API 读取本地 `data/` 并通过 chokidar 维护数据版本，前端使用 SSE 收到变更后重新拉取。未来可增加文件校验、schema 检查和错误列表。仍应保持 markdown/yaml 为唯一数据源，避免引入数据库。

## 健康度计算

MVP 已砍掉健康度计算。未来如果恢复，应作为派生指标实现，不写回源文件。建议先定义评分输入，例如阻塞数量、P0 未完成数量、契约不稳定数量，再在 API 层生成只读结果。

## 变更历史

MVP 不实现变更历史。未来可优先依赖 git log 读取 `data/` 仓库历史，而不是自己保存历史表。若 `data/` 被剥离成独立 repo，历史查询应只针对数据 repo。

## 关联图

MVP 不画图。未来图谱可以从产品、功能点和契约引用中生成。图数据建议由后端输出 `{ nodes, edges }`，前端只负责布局和交互，避免在 React 组件里解析 markdown。
