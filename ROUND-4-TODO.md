# Atlas Round 4 待办清单

## 上下文

本文档由 Round 3 重构(批次 1' ~ 5')尾声生成,记录已识别但本轮不实施的需求。
每条记录"为什么本轮没做"+ "什么时候适合再启动"。

**不是承诺要做,是评估清单**。下一轮启动时优先翻这份清单,而不是新增凭空想象。

## 已识别项

### 1. SubModule 中间层级(Module → SubModule → Feature 三层)

**背景**: 用户在 Round 3 末提及"学员管理"案例,显示当前 Module/Feature 两层颗粒度不够,业务大类(比如"销售线"下的"售前/签单/续费")缺少子分组。

**本轮不做原因**: 横向扩展,不影响主流程改造。markmap 当前布局已足够清晰,加一层不会立刻好用。

**启动时机**: example-erp 实际录入第二个产品(比如教务线 v3.1)时观察是否复发。或当某个 module 内 feature 数 > 10 时考虑。

**预计工作量**:
- feature.md frontmatter 加 `submodule?: string` 字段
- markmap 多渲染一层
- 数据迁移工具(把现有"伪 submodule"——比如 IntakeText 等隐式分组——抬升出来)
- 反馈池机制不变(还是挂在 feature 级别)

### 2. mind-elixir 备选评估

**背景**: markmap 横向布局已满足需求,但 mind-elixir 视觉更接近经典 XMind,节点更立体。

**本轮不做原因**: markmap 已工作良好,切换收益不明,且要重写交互层(点击/缩放)。

**启动时机**: 功能点数量增长到 100+ 时如果 markmap 布局拥挤,再评估。或用户主动提及视觉不够直观时。

### 3. 原型 Agent prompt 模板

**背景**: DesignTab 当前的 generate prompt 是占位文案("原型生成 prompt 模板将在后续轮次定义,当前占位"),revise 同样占位。

**本轮不做原因**: 原型工作流尚未定形。用户提及"ChatGPT images2 + James-Design 插件"但具体流程未明,模板写出来可能没人用。

**启动时机**: 用户完成一次手工原型生产后,提炼出可复用的提示词模板。届时直接填进 `apps/api/src/services/generatePromptBuilder.ts` 的 `buildPrototypeGeneratePrompt` 和 `revisePromptBuilder.ts` 的 `buildPrototypeRevisePrompt`。

### 4. ConventionsTab 的反馈池机制

**背景**: L0 规范(CONVENTIONS.md)当前只走 generate(重跑覆盖)模式,没有反馈池,也没有 revise prompt。

**本轮不做原因**: `GlobalFeedbackScope` 没有 `conventions`,schema 扩展成本较高(parser/writer/UI 三处都要加分支)。重跑覆盖在 L0 这种"全集快照"语义下是合理的。

**启动时机**: 用户使用 L0 规范一段时间后,如果发现"重跑覆盖"太重不适合细节修改(比如"我只想改命名约定的某一条"),再评估加 conventions scope。

**预计工作量**: 单点改动,但跨多处:
- `GlobalFeedbackScope` 加 `"conventions"`
- parser/writer 加第四段
- ConventionsTab 加 GlobalFeedbackPanel
- revisePromptBuilder 加 `buildConventionsRevisePrompt`
- 弹窗 scope 选择器扩展

### 5. revise prompt 拆分(修订 vs 新增分两个按钮)

**背景**: 当前底部的 revise prompt 把"对象级反馈(修订现有 feature)"和"全局需求池(新增 feature)"合在一起给 Agent。

**本轮不做原因**: 用户决定先用一段时间看实际效果再决定是否拆分。Agent 在 prompt 里已经被明确告知"全局需求池是新增,对象级反馈是修订",理论上不会混。

**5' 补丁微调**: prompt 模板已要求 Agent 直接清理 GLOBAL-FEEDBACK.md 已处理条目(原方案是让 Agent 告诉用户去 UI 删,实测用户经常忽略导致全局需求池积累垃圾)。

**启动时机**: 用户实际跑过 5+ 次 revise 后,如果发现 Agent 在新增任务上敷衍(比如只改了现有 feature 没新建),或者 prompt 长度膨胀影响 Agent 处理,拆成两个按钮:
- 「📋 复制反馈修订 prompt」: 只装 needs_revision=true 的对象级反馈
- 「📋 复制全局需求 prompt」: 只装 GLOBAL-FEEDBACK.md 内容

### 6. TBD / 决策 tab 是否恢复

**背景**: 反馈池上线后语义重叠("看的很杂"),Round 3 批次 4' 补丁删除了 tab,但数据仍在 entity .md 文件中(`## 决策` 段和字段表 `[TBD]` 标记由 `entityParser.ts` 继续解析)。

**本轮不做原因**: 用户明确"看的很杂"删除。

**启动时机**: 用户实际工作中如果产生明显的"我需要看全产品决策"需求,或第三方 Agent 需要消费 TBD 聚合数据时再评估恢复。

**预计工作量**: 极小:
- 恢复 `productAuxRouter` 的 `GET /tbd-items` / `GET /decisions` 两个端点(代码已删,但 git history 有)
- 恢复 TBDTab.tsx / DecisionTab.tsx(同上)
- phaseTabs 重新加这两个 tab

数据未删,基本是"git revert"工作量。

### 7. legacy-id 数据迁移

**背景**: legacy-id(示例产品)用 STATUS.md 6 列表老结构,与新的 modules/features 树形结构隔离。

**本轮不做原因**: legacy-id 是 `live` 状态,Round 3 重构期间不动它。

**启动时机**: legacy-id 进入新的功能迭代周期时,或用户希望在示例产品上试用反馈池机制时,考虑迁到 modules/features 树。

**预计工作量**:
- 21 个 feature 手工迁移成 modules/<m>/features/<f>.md
- STATUS.md 老段清理(保留概览/待办/阻塞/流程图,删除 ## 功能点 表)
- 决定 module 划分(题库 / 学习核心 / 用户管理 / 等)
- 反馈池 / GLOBAL-FEEDBACK / CONVENTIONS 后续 Agent 自助生成

迁移过程中 legacy-id 短期不可用(几小时级)。建议挑非工作日做。

## 维护说明

- 每条待办在 ROUND-4-TODO.md 中独立编号。
- 启动某一条时,在该条下追加 `**启动于**: YYYY-MM-DD`,并新建对应分支 `r4-task-<N>-<short-name>`。
- 完成后该条移到 ROUND-4-DONE.md(本轮不创建,等真正完成第一条时再建)。
- 启动一条前,先确认本清单的"启动时机"条件是否真的发生了,而不是仅仅因为有空想起来这一条。

## 不在本清单的事(显式排除)

- 引入 LLM SDK / 内置 Agent runtime(Atlas 哲学是 prompt-out 模式,不改)
- 数据库化(Atlas 哲学是 markdown-files-in-git,不改)
- 多用户/权限/审计(Atlas 是单用户 local-first 工具,不做)
- 移动端响应式(桌面优先,不做)
- 国际化(中文为主,英文文档同步即可,不做 i18n 框架)
