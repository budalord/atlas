# Atlas

Agent-native 多产品规格管理系统。本地 markdown / yaml 是唯一数据源,Atlas 在 Vite + React 前端把它们渲染成结构化的产品规格界面;Agent (Codex / Claude Code) 直接读写这些文件作为协作通道。

单人工具,默认本地优先,不依赖外部数据库。

## 启动

```bash
npm install
npm run dev
```

启动后:

- 前端: http://127.0.0.1:5173
- API:  http://127.0.0.1:3001/api/health

## 能干什么

- **产品总览 + 产品详情**:按 theme 分组列出 `data/products/*`,详情页按 phase 切 tab(概览 / 功能点 / 实体 / 规范 / 设计 / Git)。
- **三层架构功能点**:`module` → `module_group` → `feature`,叶子功能点 markdown 含描述 / 字段清单 / 状态转移 / 字段权限 / 反馈池等结构化段。详见 [ATLAS-SPEC.md](ATLAS-SPEC.md)。
- **实体层**:跨模块共享或模块独占的实体,字段表、关系、决策、TBD 项自动聚合。
- **对象级反馈池 + 全局需求池**:对一个 feature/entity 写反馈,UI 标记 `needs_revision`;新增功能点的整体需求落 `GLOBAL-FEEDBACK.md`。一键复制 revise prompt 给 Agent 处理。
- **Intake 向导**:多阶段录入新产品,自动生成空骨架 + Codex prompt 模板。
- **L0 规范文件 + 产品规格层文件**:`CONVENTIONS.md` 装产品级硬约束;`DECISIONS.md` / `SEAMS.md` / `RISKS.md` 等装产品级横切信息(Round 4 阶段 1 仅渲染原文)。
- **Codex 任务队列**:UI 直接触发 Codex 在后台跑 refine/generate 任务,完成后给 diff 区让你接受/拒绝。
- **GitHub 集成**:在 meta.yml 填 `repo: owner/name`,详情页 Git 区显示最近 commit + PR/Issue。
- **流程图派生**:`derived/flowcharts/main.mmd` 由功能点 source 派生,严格遵守 [flowchart-contract](docs/flowchart-contract.md)。
- **文件监听 + SSE**:`chokidar` 监听 `data/`,前端通过 `/api/events` 收 `data-change` 自动 refetch。

## 仓库结构

```
apps/
  api/        Express + TypeScript,读 data/ + 喂前端
  web/        React + Vite + Tailwind
packages/
  shared/     共享类型 (@atlas/shared)
data/
  products/   产品目录(本仓库默认只放 atlas dogfood + example-* 示例)
  contracts/  跨产品契约
  agents/     CLAUDE.md / 提示词模板
  roles.yml   角色注册表
docs/
  ATLAS-SPEC      —— markdown 规范(产品/模块/功能点/实体文件结构)
  DATA-MODEL      —— 数据形态总览
  ARCHITECTURE    —— 服务端 + 前端架构
  flowchart-contract       —— 流程图派生契约
  feature-source-contract  —— 功能点 source 契约
  EXTENSION-GUIDE —— 扩展点指南
AGENTS.md / .claude/skills/alts/SKILL.md   —— Agent 操作规范(双镜像,以 AGENTS.md 为准)
```

## 添加新产品

详见 [ATLAS-SPEC.md](ATLAS-SPEC.md)。简化流程:

1. UI 顶部「+ 新建立项产品」生成空骨架,或拖入汇总 md 走单文件导入。
2. 按 `data/products/<id>/` 的标准结构在文件系统直接编辑(`meta.yml`、`STATUS.md`、`modules/<m>/features/<f>.md`、`entities/`),Atlas 自动 refetch。
3. 在 UI 触发 generate / refine prompt,丢给 Agent 完善内容。

> 真实业务数据请放在你自己的 fork 或本地仓库,**不要 PR 到本仓库** —— `.gitignore` 已把 `data/products/*` 默认排除,只允许 `atlas/`(dogfood)和 `example-*` 前缀。

## 技术栈

TypeScript / React 18 / Vite / Tailwind / Express 4 / chokidar / markmap / mermaid / yaml。

## License

[MIT](LICENSE)
