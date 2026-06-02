# 开发中阶段:需求框 → Session/Task/Plan/Step 编排树(方案 v2)

> 状态:待评审 · 日期:2026-05-31 · v2 取代 v1(单发 codex)
>
> **本轮已拍决策**
> - 改动目标 = Atlas 规格 markdown(`data/products/<id>/`),不碰真实代码仓。
> - 粒度 = 开发中阶段产品级一个需求框。
> - 范围 = **只先上 `product-instruct`**;立项 11 个旧 kind 保持扁平不动。
> - ReAct 归属 = **Plan = 一次 codex run**,codex 内部 观察/思考/行动/结果 即 Step(靠现有 `onStep`/JSONL 回显)。
> - 沙箱/并发 = **先串行 + 现有 `.atlas-staging` 暂存**;worktree + 并行 Sandbox 留二期。
>
> **硬约束(memory:原型/壳流程不可变)**:重构只能**复用现有三态闸**,**不另起平行审核态**。
> 每个 Task 仍走 `queued→running→awaiting_review→completed/rejected` + 现有 `ReviewChangesetModal` 按文件 accept/reject。
> Session 只是父节点 + 规划器,**没有新的 session 级审核状态机**。

---

## 0. 一句话

一次需求框提交 = 一个 **Session**。Session 先跑一次**规划器**(只读 codex)把一句话需求拆成 1..N 个 **Task**;每个 Task 在自己的暂存沙箱里**串行**跑(phase1 = 1 个 **Plan** = 一次 `codex exec -s workspace-write`),codex 内部 ReAct 迭代就是 **Step**(现有 `onStep` 已能抓);每个 Task 跑完落入**现有三态闸**单独审核。全部 Task 审完 = Tree Completed。

底层执行 + 暂存 + 审核闸 100% 复用 v1 已设计的 `product-instruct` 原子;新增的只有**上面一层 Session 规划与编排 + 树形进度/状态**。

---

## 1. 架构映射(图 → Atlas)

| 图中节点 | Atlas 落点 | phase1 形态 |
| --- | --- | --- |
| **Session**(会话) | 一次需求框提交;持有 `instruction` + 子 Task 列表 + 树状态 | 新增 `AgentSession` 内存对象(落盘 `~/.atlas/...` 防重启丢) |
| **Sandbox**(隔离) | 每个 Task 的 `.atlas-staging/<taskId>/` md 备份目录(现有) | 复用现有 per-taskId 备份隔离;**不**上 worktree |
| **Task**(任务) + `Workflow` 调度 | 规划器拆出的一个**带范围的子指令**;Workflow = 跨 Plan 调度 | phase1 每 Task = 1 Plan,Workflow 退化为"跑这一个 Plan";多 Plan/校验环留二期 |
| **Plan**(计划) | 一次 `codex exec` 运行(`runCodexMultiFile`) | phase1 恒为 1 个 `execute` Plan |
| **Step**(步骤) + `ReAct` | codex 单次运行内部的 观察→思考→行动→结果 迭代 | 复用 `extractStepFromCodexEvent`/`onStep` 抓出的 `TaskStep[]`,挂到 Plan 下 |
| **三态** pending/running/finished | 每个节点的 `state` | 复用现有 `TaskStage`(加 `pending` 同义于 `queued`) |
| **Tree Completed** | Session 所有 Task 进终态(completed/rejected) | 由 Session 聚合判定 |

关键:**Task 这一层 = 现有 batch task**。规划器只是在它上面加了"把一句话拆成多个带范围的 Task"和"用 Session 把它们串起来 + 树形展示"。审核闸不变。

---

## 2. 数据模型(`packages/shared/src/types.ts`)

```ts
export type NodeState = "pending" | "running" | "finished" | "failed";

export interface AgentSession {
  id: string;
  productId: string;
  instruction: string;          // 决策者原始一句话
  state: NodeState;
  createdAt: string;
  taskIds: string[];            // 子 Task(= 现有 Task.id),顺序即串行序
  planError?: string | null;    // 规划器失败信息
}

// Plan / Step 作为 Task 的子结构挂上(Task 仍是现有 batch task)
export interface TaskPlan {
  id: string;
  kind: "execute" | "validate" | "fix";   // phase1 只用 execute
  state: NodeState;
  steps: TaskStep[];                        // 复用现有 TaskStep(codex onStep)
  changedFiles?: ChangedFile[];             // 该 Plan 产出的变更(phase1 即 Task 的变更)
}
```

- `TaskKind` 加 `"product-instruct"`;`ProductInstructTask extends BaseTask { kind:"product-instruct"; instruction:string; sessionId:string; plans:TaskPlan[]; }`。
- 其余 10 个 kind 不加 `plans`/`sessionId`,**零影响**。
- **不新增审核状态**:Task 的 `stage` 仍是现有 `TaskStage`;`NodeState` 只用于 Session/Plan 的树形展示,`pending↔queued`、`running↔running`、`finished↔completed` 一一对应。

---

## 3. 调度(三层,全串行)

```
Session 调度器(新, sessionOrchestrator.ts)
  1. 规划:runCodex(read-only, buildSessionPlanPrompt) → JSON {tasks:[{title,scopedInstruction,targetHint}]}
       └ 解析失败 / 只出 1 条 → 兜底为「整条 instruction = 单个 Task」
  2. 串行 for each task:
       └ enqueueBatch({kind:"product-instruct", instruction:scopedInstruction, sessionId})
            └ 现有队列 tick → runProductInstruct(t)               ← Task 调度(Workflow)
                 └ Plan[execute]: runCodexMultiFile(buildProductInstructPrompt)  ← Plan
                      └ codex 内部 观察→思考→行动→结果 → onStep → plan.steps[]   ← Step(ReAct)
                 └ diff → .atlas-staging 备份 → awaiting_review(现有三态闸)
       └ 等该 Task 被人 approve/reject 后再起下一个?或全部 enqueue 后各自独立审?
         (见 §决策点 D1)
  3. 全部 Task 终态 → Session.state=finished(Tree Completed)
```

### 决策点 D1(留给评审,phase1 我建议默认值)
**Task 之间是"跑完一个审一个再跑下一个",还是"依次跑完都进待审、人统一审"?**
- 建议默认:**依次入队、各自独立进现有待审区**(现有队列本就串行执行,审核互不阻塞)。这样最贴现有 `AgentTasksPanel` 行为,改动最小。
- 若要"审完再跑下一个"(更像 Workflow 强顺序),需在 orchestrator 里等前一个 Task 进终态——留二期。

---

## 4. 改动清单(分期)

### Phase 0 · product-instruct 原子(= v1 方案,仍需先落)
即 v1 §3 的全部:`TaskKind` 加种类、`tasks.ts` 路由收 `instruction`、`taskQueue.ts` 加 `runProductInstruct` + payload 带指令、`buildProductInstructPrompt`。**它就是树里的单个 Task。** 可独立验收。

### Phase 1 · Session 层 + 规划器 + 树(本方案新增主体)
1. **types**:`AgentSession` / `TaskPlan` / `NodeState`(§2)。
2. **`apps/api/src/services/sessionOrchestrator.ts`(新)**:
   - `createSession(productId, instruction)`:跑规划器 → 建 Session → 串行 `enqueueBatch` 各 Task(带 `sessionId`)。
   - `getSession(id)` / `listSessions(productId)`:返回树(Session→Tasks→plans→steps)。
   - Session 状态聚合 + 落盘(`~/.atlas/products/<id>/sessions/<id>.json`,best-effort,照 `taskHistory` 写法)。
3. **`buildSessionPlanPrompt(productId, instruction)`(新, generatePromptBuilder 同款风格)**:只读;喂产品模块/功能索引 + 指令;要求输出严格 JSON 的 Task 列表(title/scopedInstruction/targetHint)。配 JSON 解析 + 兜底单 Task。
4. **`taskQueue.ts`**:`runProductInstruct` 把 codex `onStep` 写进 `plan.steps`(而非 task 顶层 `steps`);task 完成/终态时回调 `sessionOrchestrator` 更新 Session 聚合态。`enqueueBatch` 透传 `sessionId`。
5. **路由**:`POST /api/tasks {kind:"product-instruct"}` 改为**创建 Session**(`createSession`)而非直接入队单 task;新增 `GET /api/sessions/:id`、`GET /api/products/:id/sessions`。审核仍走现有 `/api/tasks/:tid/approve|reject|changeset`(Task 粒度,不变)。
6. **前端**:
   - `DevInstructBox.tsx`(新):textarea + 提交 → `POST /api/tasks`(现在返回 session)。
   - `SessionTreePanel.tsx`(新):按图渲染 Session→Task→Plan→Step,三态徽章(pending 灰 / running 蓝 / finished 绿),Step 区展开看 codex ReAct 日志。
   - `ProductDetail.tsx`:`phase==="in-progress"` 时挂 `DevInstructBox` + `SessionTreePanel`。
   - 审核:Task 进 `awaiting_review` 时,树节点上挂"审核"入口 → 复用现有 `ReviewChangesetModal`(**不改**)。

### Phase 2(留)· Workflow 实化 + 监管
- Task 内多 Plan:`execute → validate → fix` 环;validate 不过自动起 `fix` Plan。
- 监管 agent:在 Plan 产出 changeset 后、进 `awaiting_review` 前,加一道只读复核 agent 按 contract/一致性把关,不过则回吐执行 agent 自修。挂在 `runProductInstruct` 这一个函数里,不波及旧 kind。

### Phase 3(留)· worktree + 并行 Sandbox
- 每 Task 一个 git worktree 做真隔离 → 多 Sandbox 并发;解决生命周期/冲突/合并回主线。

---

## 5. 复用 vs 新增(对齐硬约束)

| 复用(不动) | 新增 |
| --- | --- |
| 三态闸 `queued→running→awaiting_review→completed/rejected` | Session 父节点 + 规划器 |
| `runCodexMultiFile` / `.atlas-staging` 备份 / snapshot-diff | `sessionOrchestrator.ts` |
| `ReviewChangesetModal` 按文件 accept/reject | `buildSessionPlanPrompt` |
| `approveTask`/`rejectTask`/`restoreFromBackups`/`clearBackups` | `TaskPlan`/`AgentSession` 类型 + 树 UI |
| `onStep`/`extractStepFromCodexEvent` | `DevInstructBox` / `SessionTreePanel` |

**不新建任何并行审核状态**;Session/Plan 的 `NodeState` 仅供树形展示,真实闸门只有现有那一套。

---

## 6. 验证标准

1. **规划器**:`buildSessionPlanPrompt` 输出可解析 JSON;给"重做退费流程并更新相关屏"应拆出多 Task,给"STATUS 改个字"兜底单 Task。(可对 prompt 字符串 + 解析函数做单测,planner 跑通靠本地)
2. **路由**:`POST /api/tasks {kind:"product-instruct", instruction}` 返回 session 对象;缺 instruction → 400。`GET /api/sessions/:id` 返回完整树。
3. **三态闸复用**:每个子 Task 仍进 `awaiting_review`,`ReviewChangesetModal` 按文件 accept/reject,approve 清备份、reject 回滚——与现有 batch 行为逐字一致(回归)。
4. **树 UI**:本地起 Atlas,某产品置 `in-progress`,输入需求 → 树按 pending/running/finished 实时推进,Step 区出现 codex 动作日志 → 全 Task 审完显示 Tree Completed。
5. **重启**:Session 落盘后重启 Atlas 能读回树(若实现落盘)。

> 注:codex 段无法纯单测;ERP 现为 `planning`,需推进到开发阶段或临时改 `meta.status` 才显示框。

---

## 7. 不做 / 边界

- 不碰真实代码仓;不碰立项 11 个旧 kind;不上 worktree/并行(phase3)。
- 不新建 session 级审核状态机(复用三态闸)。
- 不删孤儿 `promptTemplates.ts`。
- Workflow 多 Plan / 监管 agent 是 phase2,本期 Task=1 Plan,先把四层骨架与树跑通。
```
