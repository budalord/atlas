# Atlas 实施笔记

两轮迭代,分别对应:

- **轮 1 立项期能力扩展**:实体 / TBD / 决策 / 模块 / 立项期录入。计划 `~/.claude/plans/1-silly-pnueli.md`,见下方「立项期能力扩展」一节。
- **轮 2 功能点工作台 + 单 agent 串行处理**:导入汇总 md / 金字塔可视化 / 功能点抽屉 + 线索池 / Codex CLI refine + diff 审阅。计划 `~/.claude/plans/atlas-a-elegant-fairy.md`,见下方「功能点工作台」一节。

---

## 功能点工作台(本轮)

### 实际改动文件

**规范**
- 仓库根目录 `ATLAS-SPEC.md` — 立项期产品的 markdown 结构规范(目录布局、命名、MODULE.md / 功能点 md / 单文件汇总格式、ProductStatus 说明)。

**Schema (`packages/shared/src/types.ts`)**
- 新增 `FeaturePoint`、`FeaturePointPreview`、`FeatureClue`、`ModuleColor`、`ModuleWithFeatures`、`RefineTask`、`TaskStage`。
- 扩展现有 `ModuleSpec`:加 `id? / role? / color? / order? / featureCount?` (可选,旧 MODULE.md 不破坏)。

**后端解析与落盘**
- `apps/api/src/services/featureParser.ts` — 解析单个功能点 md(frontmatter + `## 描述` + `## 线索池`/`### Pending`/`### Resolved` + 线索行 `- (YYYY-MM-DD) content`)。
- `apps/api/src/services/aggregateMdParser.ts` — 解析单文件汇总 md → `{ product, modules: [{ meta, role_desc, features }] }`。`AggregateValidationError` 在校验任一项失败时抛出(kebab-case、color 枚举、module/feature id 唯一)。
- `apps/api/src/services/aggregateMdImporter.ts` — 把解析结果落盘到 `data/products/<id>/` 全套目录。失败时回滚整目录(尽力)。`AggregateImportConflict` 在产品 id 已存在时抛 409。
- `apps/api/src/services/productScaffold.ts` — 从 `routes/products.ts` 抽出 `blankStatusMarkdown()`,被 blank-create 和 aggregate-importer 共用。
- `apps/api/src/services/entityLoader.ts` — `loadModules()` 扩展读取 frontmatter(id/role/color/order/featureCount,按 order 排序)。新增 `loadFeatures / loadFeature / loadModulesWithFeatures / featureFilePath / featureSourcePath`。

**后端路由**
- `apps/api/src/index.ts` — `express.json` 上限从默认 100KB 提到 5MB(容纳大型汇总 md);挂载 `featuresRouter` 和 `tasksRouter`。
- `apps/api/src/routes/products.ts` — 新增 `POST /api/products/import-aggregate`(注册顺序在 `/blank` 之后、`/:id` 之前)。
- `apps/api/src/routes/entities.ts` — `productAuxRouter` 增加 `GET /modules-with-features`。
- `apps/api/src/routes/features.ts` — 新建。`GET /:fid`、`POST /:fid/clues`、`POST /:fid/refine`、`GET /:fid/draft`。
- `apps/api/src/routes/tasks.ts` — 新建。`GET /`、`GET /:tid`、`POST /:tid/approve`、`POST /:tid/reject`、`POST /:tid/retry`。

**Codex CLI 接入**
- `apps/api/src/services/codexRunner.ts` — `spawn('codex', ['exec', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '-s', 'read-only', '--color', 'never', '--json', '-o', <tmp>, '--cd', <productDir>])`。prompt 通过 stdin 喂入,最终回复从 `-o` 文件读取(stdout 是 JSONL 事件流,目前不消费)。5 分钟超时 → SIGKILL。PATH 中无 `codex` 时返回 `{ok:false, error:'codex CLI not found in PATH'}`。
- `apps/api/src/services/taskQueue.ts` — 内存 FIFO 单 agent 串行队列。Task 形如 `{ id, productId, featureId, stage:'queued|running|awaiting_review|completed|rejected|failed', startedAt/finishedAt/error }` + 私有 payload。`tick()` 在 idle 时拉起首个 queued。完成后写 `<fid>.md.draft`,状态 `awaiting_review`。`approveTask` 把 draft 覆盖 main + 删 draft;`rejectTask` 删 draft;`retryTask` 新建任务携带追加指令并把原任务标 rejected。每次 stage 转换调 `bumpDataVersion()` 让前端 SSE 拉新。
- `apps/api/src/services/watcher.ts` — 加 `bumpDataVersion(changedPath)` 供非文件事件(任务状态)广播。

**前端**
- `apps/web/package.json` — 增 `react-diff-viewer-continued ^4.2.2`。
- `apps/web/src/lib/useDataChange.ts` — **修了上轮埋下的 stale closure**:用 `useRef` 持有最新 handler,避免 productId 切换后 SSE 仍用旧闭包(原本上轮没暴露,因为没写场景;本轮加 add-clue 后浮现)。
- `apps/web/src/types/index.ts` — 透传新类型 (`FeaturePoint`、`ModuleColor`、`ModuleWithFeatures`、`RefineTask`、`TaskStage` 等)。
- `apps/web/src/stores/uiStore.ts` — 加 `pendingFeatureOpen / requestFeatureOpen / consumeFeatureOpen`(给 TaskQueueWidget 跨组件请求"打开 feature 抽屉"用)。
- `apps/web/src/components/ImportAggregateForm.tsx` — 新建。`ProductList` 顶部内联展开;拖拽 .md 或点选 → 读 `.text()` POST 到 `/api/products/import-aggregate`。
- `apps/web/src/components/ProductList.tsx` — 挂入 `ImportAggregateForm`。
- `apps/web/src/components/tabs/FeatureTab.tsx` — 新建。金字塔三层:产品概述卡 → 模块卡片网格(color 色条+role chip+features 数量) → 当前模块功能点卡片网格。"按模块 / 全部平铺" toggle。`onOpenFeature` 把请求向上抛给 ProductDetail。
- `apps/web/src/components/ProductDetail.tsx` — `TABS` 首位插 `features`,默认 tab。引入 `openFeatureId` 状态托管 `FeatureDrawer`。订阅 `uiStore.pendingFeatureOpen`(productId 匹配时消费并打开抽屉)。
- `apps/web/src/components/FeatureDrawer.tsx` — 重构 Step 4 的版本:加 `🤖 处理 pending 线索` 按钮(无 pending 或有任务在跑时禁用)、`currentTask` 计算、awaiting_review 时显示 diff 区(`react-diff-viewer-continued` splitView)+ ✅接受 / ❌拒绝 / 🔄重做(可填补充指令);queued/running 显示 banner;failed 显示错误。
- `apps/web/src/components/TaskQueueWidget.tsx` — 新建。右下角 floating chip,折叠态显示活动任务计数 + 色块/spinner,展开态分 running / queued / awaiting_review / 最近完成 四段。点击 task 行 → 通过 uiStore 请求打开该 feature 抽屉。
- `apps/web/src/App.tsx` — 挂载 `TaskQueueWidget`。

### 偏离本计划的决定

1. **POST /api/products/import-aggregate 用 `source` 字段**(原 plan 没指定),前端读 `file.text()` 后传入,避免上传 multipart。
2. **MODULE.md 描述兼容老格式**:`loadModules()` 既读 frontmatter(新格式),也回落到 H1 + 第一段(老格式)。上轮造的 erp `MODULE.md` 因此不破坏,新导入的产品 frontmatter 字段直接取用。
3. **Codex `--ignore-user-config`**:本机 `~/.codex/config.toml` 被 brew cask 安装路径写成了 root:staff 600 权限(原因不明,可能是 postinstall 副作用),普通用户进程读不到。用 `--ignore-user-config` 绕过,模型用 Codex 默认。**用户可后续 `sudo chown $USER ~/.codex/config.toml` 拿回自己的 config**。
4. **`extractSection` 正则 bug 修复**:原 `${heading}\\s*\\n(.*?)(?=\\n##\\s+|$)` 中的 `\\s*` 会贪婪吃掉下节前的空行,把边界标记 `\\n##` 一并消耗,导致 lazy 捕获跨节抓到下节内容。改为 `[^\\n]*\\n`,只消费 heading 行的剩余字符。修在 `markdownParser.ts` 和 `featureParser.ts` 两处。已用老结构产品的现有 STATUS.md 验证解析不受影响。
5. **`useDataChange` stale closure 修复**:本意是 Step 4 时改的(产品切换后 SSE 用旧 productId 把 FeatureTab 数据清空),本轮也受益。

### 已知遗留

- **`~/.codex/config.toml` 权限**:见上,需用户手动 chown 才能让用户级 Codex 配置生效。
- **任务在 Atlas 进程内存**:重启 Atlas 队列丢失,任何遗留 `.md.draft` 没有归属任务,需手动 `rm` 或重新触发 refine。MVP 范围内可接受。
- **prompt 中的"已 resolved"列表会随每次 refine 累积喂给模型**,大型功能点可能 token 膨胀。下版本可裁剪到最近 N 条。
- **diff 区在非常长 feature md 上会撑高抽屉**,目前无虚拟化。
- **TaskQueueWidget 的"最近完成"段是进程内存,刷新页面后 completed/rejected 任务仍在,直到 Atlas 重启**(因为也是同一内存)。这是 feature 还是 bug 取决于你怎么看。
- **Codex 输出偶尔会被包在 ```markdown 围栏里**,已加 `stripCodeFence` 兜底,但若模型输出形式更怪(比如多段 frontmatter)目前会直接判 fail 让用户重做。

### 端到端 29 步验收(对照 plan §端到端)

剧本里的关键步骤都已浏览器实跑过:

| 步 | 状态 |
|---|---|
| 1-2 | ✅ 拖入 `/tmp/atlas-test-aggregate.md`(5 模块 × 3 功能点),201 + 跳转 ERP 产品页 |
| 3-5 | ✅ 「功能点」tab 默认,5 模块卡片色/role 正确,3 功能点显示 |
| 6-7 | ✅ "全部平铺"显示 15 个 feature 分组 |
| 8-11 | ✅ 抽屉滑出,描述+Pending+Resolved 渲染,输入 "应该支持批量导出" → Pending 顶部插入新行(含今日日期),SSE 同步 |
| 12-15 | ✅ 点 🤖 → 队列 running ~30s → awaiting_review,抽屉出现 diff splitView |
| 16-18 | ✅ Diff 显示描述被改写、3 条 pending 全部移到 resolved;点接受 → 原 md 被覆盖,.draft 删除,抽屉 PENDING 0 条 / RESOLVED (3) |
| 19-21 | ⏭ retry+extra 路径已写好但未在本次实跑;后端单元上有 retry endpoint 已就绪 |
| 22-23 | ⏭ reject 路径同上 |
| 24-25 | ⏭ 串行 3 个任务排队:taskQueue 代码用 `running` 锁 + `tick()` 递归,单跑 1 个,已经过 backend smoke + 内存验证;UI 也会显示 running/queued 三段 |
| 26-27 | ✅ 切到老结构产品,功能点 + 待办,概览/契约/CLAUDE.md 完整 |
| 28-29 | ✅ 上轮的 test-erp 已在 Step 1 验收时与本轮 erp 一并清空重建,实体/TBD/决策 tab 框架仍正常加载(空数据,因为本轮 erp 没用 entities 路径) |

---

## 立项期能力扩展(上轮存档)

执行计划见 `~/.claude/plans/1-silly-pnueli.md`。本笔记记录实际改动、偏离与遗留。

## 实际改动文件

### Schema (单一数据源)
- `packages/shared/src/types.ts` — 新增 `FieldRequired`、`FieldSpec`、`RelationSpec`、`DecisionSpec`、`EntitySpec`、`TBDItem`、`DecisionRecord`、`ModuleSpec`;`ProductStatus` 加 `"planning"`;`ProductMeta.source_path` 改为 `string | null`(立项产品无源仓库)。

### 后端
- `apps/api/src/services/entityParser.ts` — 新增。沿用 `markdownParser.ts` 的 frontmatter + section-walker 风格,一遍扫描产出 `{ fields, relations, decisions }`。TBD 检测覆盖三处:字段「必填」列 `TBD`、关系行尾 `[TBD]`、决策标题以 `TBD -` 开头或行内含 `[TBD]`。
- `apps/api/src/services/entityLoader.ts` — 新增。`loadEntities(productId)` 同时扫描顶层 `entities/` 与 `modules/*/entities/`,赋 `module: string | null`。`loadEntity()` 单实体查找(优先顶层后模块)。`loadModules()` 解析 `MODULE.md` 的 H1 标题与首段描述。
- `apps/api/src/routes/entities.ts` — 新增两个 router:
  - `entitiesRouter`(挂在 `/api/products/:id/entities`):`GET /`、`GET /:name`、`POST /`(用 `Request<{id,name}>` 显式类型解决 `mergeParams` 的类型问题)。
  - `productAuxRouter`(挂在 `/api/products/:id`):`GET /tbd-items`、`GET /decisions`、`GET /modules`。
- `apps/api/src/routes/products.ts` — 新增 `POST /blank`,**注册顺序在 `GET /:id` 之前**。写 `meta.yml` + 最小骨架 `STATUS.md`(六段空标题,功能点表头保留 6 列),状态 `"planning"`,不写 `INTAKE.md`。
- `apps/api/src/index.ts` — 挂载 `entitiesRouter` 和 `productAuxRouter`(顺序在 `productsRouter` 之前,但因路径前缀互斥,实际顺序不影响)。
- `apps/api/src/routes/git.ts` — 加 `meta.source_path` 为 null 时的提前返回,避免 `path.resolve(null)`。
- `apps/api/src/routes/intake.ts` — `meta.source_path ?? ""` 三处(`POST /start` 响应、`GET /list` 响应、`intakeDiscoverPrompt`),保持 `IntakeListItem.source_path: string` 不变。

### 前端
- `apps/web/src/types/index.ts` — 透传新 schema 类型。
- `apps/web/src/lib/useDataChange.ts` — 新增 hook,组件内订阅 SSE `data-change` 事件触发 refetch。
- `apps/web/src/components/ProductDetail.tsx` — 重写,引入 `overview / entities / tbd / decisions` 四 tab。原内容下沉为 `OverviewSection`。状态徽章对 `"planning"` 显示「立项中」。
- `apps/web/src/components/tabs/TBDTab.tsx` — 新增。按 source 文件分组,橙色卡片展示。
- `apps/web/src/components/tabs/DecisionTab.tsx` — 新增。按 entity 分组,`is_tbd` 项加橙色 TBD 徽章。
- `apps/web/src/components/tabs/EntityTab.tsx` — 新增。左侧栏「按模块 / 全部」可切;主区展示字段表(TBD 行底色橙)、关系列表(TBD 加徽章)、决策卡片。右上「+ 新建实体」表单调用 `POST /api/products/:id/entities`。
- `apps/web/src/components/BlankProductForm.tsx` — 新增。`ProductList` 顶部「+ 新建立项产品」内联展开,提交后调用 `POST /api/products/blank` 并 refetch + 选中新产品。
- `apps/web/src/components/ProductList.tsx` — 挂入 `BlankProductForm`。
- `apps/web/src/lib/statusTone.ts` — 加 `"planning"` 色调(靛蓝)与分类规则(匹配 `"planning"` / 含「立项」)。

### 数据(E2E 验收产物,可保留也可清理)
- `data/products/erp/` — E2E 验收产物。包含 3 模块(sales / academic / finance)、共享 `student.md`、`sales/order.md`。可作为后续真正立项 ERP 的起点,也可删除重来。

## 偏离本计划的决定

1. **`ProductStatus = "planning"` 提前到 Step 1 加入**。原计划放在 Step 5,但 Step 2 加 ProductDetail 状态徽章时引用了 `"planning"`,TS 报 `no overlap`。索性一次性加入。无副作用。
2. **`ProductMeta.source_path` 改为 `string | null`,而非用空串占位**。原计划只是「blank-create 时写 null」,但要让 TypeScript 干净通过,类型必须允许 null。改完连带 fix 了 `routes/git.ts`(null 时早返回)与 `routes/intake.ts`(Intake 流转响应处 `?? ""`)。`IntakeListItem.source_path` 仍保持 `string`,因为 Intake 流总是有 source_path。
3. **DecisionTab 和 EntityTab 在 Step 2 阶段就建好了**。`ProductDetail.tsx` 引入 tab 后必须直接 import 它们,留 stub 反而碍事。功能上仍按 Step 3 / Step 4 验收范围交付。
4. **模块创建没有 UI**。计划只列了「新建立项产品」「新建实体」按钮,模块创建留作 v2。E2E 中用文件系统直接 `mkdir + MODULE.md`。EntityTab 的「+ 新建实体」下拉只列出已存在的模块。

## 已知遗留

- **没有 PUT/PATCH 实体编辑端点**。修改字段、关系、决策得直接改 markdown 文件。计划范围内,SSE 已经覆盖了「改文件后前端自动刷新」。
- **没有模块创建 UI**。立项中开新模块需要在 `data/products/<id>/modules/<name>/` 手工建目录 + `MODULE.md`。
- **没有反向引用索引**。order.md 在 markdown 文本里写「引用学员实体」,Atlas 不感知。计划范围外(明确不做)。
- **TBD 全局聚合只在单产品维度**。`GET /:id/tbd-items` 没有跨产品的「Atlas 全局 TBD」视图。计划范围外。
- **`statusTone.classifyStatus` 把含「立项」的 status 也判为 `planning`**。当前只有 `ProductStatus = "planning"` 一种来源,但若未来功能点 status 用到「立项」字样,会和产品状态同色。低风险。
- **Express route `mergeParams` 类型需要显式 `Request<{id,...}>` 标注**。Express 4 的 `Router({mergeParams:true})` 不会把父路由参数推进 TS。已在 `routes/entities.ts` 用 `type ProductReq = Request<{id:string}>` 解决,可作模板供后续路由参考。

## E2E 11 步全程通过

按计划 §5 剧本,共 11 步,全部通过(详见各步 ✅ 行)。SSE 验证:改 `student.md` 删一个 `[TBD]` 标记后,`/api/products/erp/tbd-items` 立即从 3 条降为 2 条;`/api/events` 流同步收到 `data-change` 事件。老结构产品未受影响,功能点和待办照常解析。

---

## 项目 B 待办(本次范围外,等真实需求触发再做)

> 引自本轮原 prompt §未来升级方向:

本期(项目 A)已完成单 agent 串行 + 文件级 diff 模式。未来升级方向:

1. **多 agent 并行 + git 分支隔离**
   - 每个 refine 任务一个独立 git 分支,agent 在分支上改文件
   - Atlas UI 展示分支队列、并行运行状态
   - 接受则 merge 删分支,拒绝则丢弃分支
   - 触发条件:日常使用中出现"串行等不及"的真实场景

2. **CLI → HTTP 代理层**
   - 本地起轻量代理服务,把 Codex/Claude CLI 包装成 HTTP 接口
   - Atlas 后端通过 HTTP 调用代理,不直接 spawn 子进程
   - 好处:进程管理、超时、并发控制集中在代理层;
          Atlas 后端更干净;
          未来换 agent 实现只改代理不动 Atlas
   - 触发条件:进入多 agent 阶段时一起做

3. **多 agent 接入**
   - 项目 A 只接 Codex CLI
   - 后续可加 Claude Code CLI,按任务类型路由:
     - 结构化改写 → Codex
     - 复杂推理 / 需要工具调用 → Claude Code

---

## 左栏分组与入口收敛(本轮)

### UI 改动
- `apps/web/src/lib/productPhase.ts` — 新增。把 6 种 `ProductStatus` 映射为 5 个 phase 大类(进行中 / 已上线 / 立项中 / 暂停 / 归档),并定义大类顺序、默认折叠态、配色。
- `apps/web/src/components/ProductList.tsx` — 改写为 phase 一级 + theme 二级嵌套分组;立项中 / 归档默认折叠;左栏顶部仅保留单个 `+ 新建产品` 按钮。
- `apps/web/src/components/NewProductModal.tsx` — 新增。居中模态,内含「导入汇总 md」拖拽区 + 「复制 ATLAS-SPEC.md 规范」按钮。支持 ESC、点遮罩、× 关闭。
- `apps/web/src/components/ImportAggregateForm.tsx` — 改为始终展开形态,不再折叠,移除内部「取消」按钮,交由父模态控制可见性。
- `apps/web/src/components/ProductCard.tsx` — 状态 chip 缩小一档(text-[10px] 无 border),分组承担主要语义。
- `apps/web/src/components/BlankProductForm.tsx` — 删除。

### 后端改动
- `apps/api/src/routes/spec.ts` — 新增。`GET /api/spec/atlas` 实时读取仓库根 `ATLAS-SPEC.md` 并以 `text/plain` 返回。
- `apps/api/src/index.ts` — 挂载 `app.use("/api/spec", specRouter)`。

### 保留兼容
- `POST /api/products/blank` 现已无 UI 入口,仅供脚本/curl 使用(便于将来通过自动化兜底新建空骨架)。

### 创建入口二次合并

- `NewProductModal.tsx` 改为两 tab:
  - 「新建产品(发现→访谈→沉淀)」内嵌 `IntakeForm`,提交后关闭模态并跳转 `/intake/:id` wizard。
  - 「录入已有产品(导入汇总 md)」内嵌 `ImportAggregateForm`,导入完成后关闭模态并选中新落盘的产品。
  - 「复制 ATLAS-SPEC.md 规范」按钮保留在 tab 下方,文案改为「录入已有产品前,把规范贴给 Codex/Claude,让它按规范生成汇总 md」。
- `IntakeForm` 去掉折叠态/取消按钮,改为始终展开,只作模态嵌入用。
- `pages/IntakeHome.tsx` 移除页内 `IntakeForm`,改为「继续录入」纯列表页;顶栏「录入(N)」链接保留指向该页面,用于查看/恢复进行中的录入。
- 左栏入口按钮文案改为「+ 新建 / 录入产品」。

### 入口语义修正 + intake 列表页删除

- 模态 tab 顺序与语义对调到位:
  - 「新建产品」= 按 ATLAS-SPEC.md 规范立项,内嵌 `ImportAggregateForm`(导入汇总 md)。
  - 「录入已有产品」= 给已有项目地址走 Intake wizard(发现→访谈→沉淀),内嵌 `IntakeForm`,提交后跳 `/intake/:id`。
- 顶栏「录入 (N)」链接和 `pages/IntakeHome.tsx` 列表页一起删除;`/intake/:id` wizard 详情页保留供已发起的 Intake 继续。
- `App.tsx` 头部不再使用 `useIntakeStore`,布局更干净。

---

## 全流程辅助 · 第一批落地(本轮)

### Epic 1:状态机控件 + 黄牌提示
- `apps/api/src/services/productStatusFsm.ts` — 新增。5-phase 状态机:`planning/discovering → in-progress → live`,`in-progress/live ⇄ paused`,所有非 archived → archived(归档单向)。
- `apps/api/src/routes/products.ts` — 新增 `PATCH /api/products/:id/status`(校验 fsm)+ `GET /api/products/:id/readiness`(返回 startDev/goLive 的 ok + hints,仅提示不拦截)。
- `apps/web/src/lib/productTransitions.ts` — 新增。主推进按钮文案 + 折叠菜单(暂停/恢复/归档)。
- `apps/web/src/components/ProductStatusBar.tsx` — 新增。ProductDetail 顶部 sticky 状态条:phase chip + 主按钮(`readiness.ok=false` 时挂黄点)+ 折叠菜单 + toast/err 反馈。
- `apps/web/src/stores/productStore.ts` — 增加 `patchStatus(id, status)` action。
- `apps/web/src/components/ProductDetail.tsx` — 删除头部冗余的状态 chip(让 sticky 状态条承担);插入 `<ProductStatusBar />`。

### Epic 2:删除/归档
- `apps/api/src/routes/features.ts` — 新增 `DELETE /api/products/:id/features/:fid`(同时清理 `.draft`)。
- `apps/api/src/routes/entities.ts` — 新增 `DELETE /api/products/:id/entities/:name`(自动定位共享或某模块下)。
- `apps/web/src/components/FeatureDrawer.tsx` — header 加 🗑 按钮,`window.confirm` → DELETE → 关 drawer。
- `apps/web/src/components/tabs/EntityTab.tsx` — EntityDetail header 加 🗑 按钮,`window.confirm` → DELETE → 清空选中 + 重新加载。
- `apps/web/src/components/ArchiveProductDialog.tsx` — 新增。归档前要求输入产品 id 确认。
- 产品归档复用 PATCH status → "archived",由状态条折叠菜单触发。后端不暴露 `rm -rf <productDir>`。

### Epic 3:产品级 agent 任务面板
- `apps/web/src/components/AgentTasksPanel.tsx` — 新增。复用 `/api/tasks` 数据并按 productId 过滤;展示「进行中(queued/running/awaiting_review)」+ 「最近完成 5 条」;点击任意行调 `requestFeatureOpen` 打开抽屉。
- 仅当 `statusToPhase(meta.status) === "in-progress"` 时渲染(其他阶段产品不显示)。

### 状态转移规则一览
```
discovering / planning ─[开始开发]──> in-progress ─[标记上线]──> live
in-progress ─[暂停]──> paused ─[恢复开发]──> in-progress
live ─[暂停]──> paused
* (非 archived) ─[归档]──> archived  (单向,需输入 id 二次确认)
```

---

## 第二批落地:phase 权限分级 + 双轨设计 + GitHub issue 创建

### Epic 4:phase-gated tabs + added_in_phase 标记
- `packages/shared/src/types.ts`:`FeaturePoint`、`EntitySpec` 加可选 `added_in_phase / added_at`;新增 `DesignDoc`、`DesignSummary`。
- `apps/api/src/services/featureParser.ts` / `entityParser.ts`:读取 `added_in_phase / added_at` frontmatter(枚举校验)。entityParser 之前忽略 frontmatter,本轮改为复用 `parseMarkdownWithFrontmatter`。
- `apps/api/src/routes/features.ts`:新增 `POST /api/products/:id/features`,按当前产品 status 决定是否写 phase frontmatter。
- `apps/api/src/routes/entities.ts`:`POST /entities` 同样根据 status 注入 frontmatter。
- `apps/web/src/lib/phaseTabs.ts` 新增:5 phase × 6 tab 的可见/只读矩阵。
- `apps/web/src/components/ProductDetail.tsx`:tab nav 改为按 `tabsForPhase(phase)` 生成,只读 tab 标签上贴「只读」chip;`readOnly` 透传给各 tab。
- `tabs/FeatureTab.tsx`:加 `readOnly` prop + 「+ 新建功能点」入口(读写时显示)。
- `tabs/EntityTab.tsx`:同上,EntityDetail 顶部 `added_in_phase != "planning"` 时显示琥珀 banner。
- `components/FeatureDrawer.tsx`:加 `readOnly`/`productPhase`/`onOpenDesign` props;添加 banner;readOnly 时 footer 提示走 issue 流程,删除按钮隐藏。

### Epic 5:双轨设计区 MVP
- `apps/api/src/services/designLoader.ts` 新增:list/load/write/delete + `designTemplate()` 骨架。文件位于 `data/designs/<productId>/<name>.md`。
- `apps/api/src/routes/designs.ts`:替换为完整 CRUD(GET list / GET one / POST / PUT / DELETE)。
- `apps/api/src/index.ts`:挂载到 `/api/products/:id/designs`(替代之前 `/api/designs` 空 router)。
- `apps/web/src/components/tabs/DesignTab.tsx` 新增:左 240px 列表 + 右编辑/预览;只读模式只渲染 markdown,读写模式有「编辑/保存/取消」+「🗑」+「+ 新建」(下拉绑 feature)。
- `components/FeatureDrawer.tsx` 增加 📄 设计页跳转按钮,触发 ProductDetail 切到 design tab 并定位文件。

### Epic 6:GitHub issue 创建 (D1)
- `apps/api/src/services/github.ts` 新增 `createIssue(rawRepo, { title, body, labels? })` + `GitHubIssueError`。错误码 `no-repo` / `gh-missing` / `gh-error` 分别映射 400/503/502。
- `apps/api/src/routes/git.ts` 新增 `POST /api/products/:id/issues`。
- `apps/web/src/components/CreateIssueDialog.tsx` 新增:复用居中模态,字段 title/body/labels,提交成功显示 issue url + 复制/打开按钮。
- 三处挂载:FeatureDrawer / EntityDetail / DesignTab header 各加 💬 按钮 + 各自的 issue body 预填函数(`buildFeatureIssueBody` / `buildEntityIssueBody` / `buildDesignIssueBody`)。

### 冒烟验证(curl)
- ✅ planning 产品 POST feature → md 无 added_in_phase
- ✅ in-progress 产品 POST feature → md 含 `added_in_phase: in-progress + added_at`
- ✅ designs CRUD:list / POST / 重复 409 / 删除 404 都正常
- ✅ POST /issues 在 meta.repo 缺失时返回 400 + `code: "no-repo"`

下一批可考虑:codex agent 自动创建 PR (D2)、Atlas 内嵌 PR 审核 (D3)、运维事件 tab、AICatalog 实化、STATUS.md 可写入 UI。

---

## 功能点 / 线索池 视图重设计 · 三栏邮件客户端布局

### 改动
- `packages/shared/src/types.ts` — `FeaturePointPreview` 加 `pendingPreview: string[]`(顶 3 条 pending,每条 ≤80 字)。
- `apps/api/src/services/entityLoader.ts:259` — `loadModulesWithFeatures` 填充 `pendingPreview`。
- `apps/web/src/components/tabs/FeatureTab.tsx` — 完全重写为三栏布局:
  - 左 180px:模块列(色条 + role + 计数,顶含「全部 N」)
  - 中 280px:功能点卡(名称 + descriptionPreview + 顶 2 条 pendingPreview + 计数行)
  - 右 1fr:选中功能点详情(模块 chip + last_refined + banner + 工具栏 + 描述 markdown + Pending 全列 + Resolved 折叠 + 添加线索 footer)
- 右栏「🤖 处理 pending」**直接 POST refine 端点**入队,**不打开 drawer**;完成后通过 TaskQueueWidget 上 awaiting_review 点击进 drawer 看 diff。

### 不变
- FeatureDrawer.tsx 接口与逻辑保持(本轮);仍是 awaiting_review / refine 进度审阅的承接位置。
- ProductDetail.tsx 仅透传 readOnly,无结构变化。
- FeatureTable(STATUS.md 中的 feature 表)无关本轮。

### 验收
- ✅ 后端:`GET /api/products/erp/modules-with-features` 返回 `pendingPreview` 数组,有 pending 时填充、无 pending 时 `[]`。
- ✅ UI:中栏 feature card 上看得见 pending 线索原文(每条 line-clamp-1)+「+N 条更多 pending」尾注。
- ✅ 右栏:选中后渲染完整 markdown 描述 / Pending 全列 / Resolved 折叠 / 添加线索 textarea(读写态)。
- ✅ 只读 phase(live/paused):右栏底部 add-clue 区与 🤖 / 🗑 按钮自动隐藏。
- ✅ Typecheck + web/api build 全过。
