export type ProductTheme = "seo" | "erp" | "miniapp" | "tool";

export type ProductStatus =
  | "discovering"
  | "planning"
  | "in-progress"
  | "paused"
  | "live"
  | "archived";

export type FeatureStatus = "todo" | "doing" | "done" | "blocked" | string;

export type Priority = "P0" | "P1" | "P2" | "P3" | string;

import type { Feedback } from "./feedback";

export interface ProductMeta {
  id: string;
  name: string;
  theme: ProductTheme;
  status: ProductStatus;
  tech_stack: string[];
  source_path: string | null;
  deploy_url: string | null;
  created_at: string;
  tagline?: string | null;
  /** GitHub 仓库标识,例如 "owner/name" 或完整 URL。未填则关闭 GitHub 集成。 */
  repo?: string | null;
  /**
   * 简短产品描述。新建项目用(去掉 source_path 必填后,description 是必填字段)。
   * 老产品可缺失,UI 兜底用 tagline 或空字符串。
   */
  description?: string;
  /**
   * 产品规格层(Layer 2)元事实扩展(Round 4 阶段 2 新增,全部可选)。
   * 覆盖 v1 §0.1 关键事实表的 9 项内容,概览 tab 渲染。
   */
  /** 业主机构名 */
  organization?: string | null;
  /** 业务领域 */
  business_domain?: string | null;
  /** 场地/校区清单(多场地时使用) */
  campuses?: string[];
  /** 技术负责人(单人时 string;多人在 decision_makers 写明) */
  tech_lead?: string | null;
  /** 决策方清单 */
  decision_makers?: string[];
  /** 当前推进阶段一句话描述 */
  roadmap_phase?: string | null;
  /** 文档版本号(v1 / v2 / ...) */
  doc_version?: string | null;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  date: string;
  author: string;
  subject: string;
}

export interface GitHubPullRequest {
  number: number;
  title: string;
  state: "open" | "closed" | "merged";
  url: string;
  author: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
}

export interface GitHubSummary {
  /** owner/name 解析后的标识;未配置时整个 summary 为 null */
  repo: string | null;
  /** 是否启用(meta.repo 已填 + gh 可用 + 仓库可访问) */
  enabled: boolean;
  /** 当 enabled=false 时的原因短消息(unconfigured / gh-missing / gh-unauthorized / repo-error) */
  reason?: "unconfigured" | "gh-missing" | "gh-unauthorized" | "repo-error";
  /** 错误细节,UI 用来排查 */
  detail?: string;
  /** 默认分支 */
  defaultBranch?: string;
  pullRequests?: GitHubPullRequest[];
  issues?: GitHubIssue[];
}

export interface TodoItem {
  text: string;
  done: boolean;
}

export interface FeatureSpec {
  id: string;
  description: string;
  status: FeatureStatus;
  priority: Priority;
  endpoint: string;
  notes: string;
}

export interface Product {
  id: string;
  meta: ProductMeta;
  last_updated: string | null;
  summary: string;
  todos: TodoItem[];
  blockers: string[];
  features: FeatureSpec[];
  statusMarkdown: string;
}

export interface ContractMeta {
  provider: string;
  consumers: string[];
  status: string;
}

export interface Contract {
  id: string;
  title: string;
  meta: ContractMeta;
  markdown: string;
}

export interface ClaudeDoc {
  markdown: string;
  updated_at: string | null;
}

export interface ApiEnvelope<T> {
  data: T;
  version: number;
}

export type IntakeStage =
  | "stage1"
  | "stage2"
  | "stage2-pending"
  | "stage3"
  | "finalized"
  | "done";

export interface IntakeStatus {
  productId: string;
  stage: IntakeStage;
  files: {
    intake: boolean;
    discovery: boolean;
    interview: boolean;
    interviewAnswered: boolean;
    status: boolean;
    archived: boolean;
  };
}

export interface IntakeListItem {
  id: string;
  name: string;
  theme: ProductTheme;
  source_path: string;
  created_at: string;
  stage: IntakeStage;
}

export interface IntakeStageResponse extends IntakeStatus {
  info: {
    id: string;
    name: string;
    theme: ProductTheme;
    source_path: string;
    created_at: string;
    status: ProductStatus;
  };
}

export interface IntakePrompts {
  discover: string;
  interview: string;
  finalize: string;
}

export type FieldRequired = "yes" | "no" | "TBD";

export interface FieldSpec {
  name: string;
  type: string;
  required: FieldRequired;
  constraint: string;
  notes: string;
  is_tbd: boolean;
}

export interface RelationSpec {
  /** 形如 "N:1"、"1:N"、"M:N"、"1:1" 或自由文本 */
  cardinality: string;
  /** 目标实体描述,如 "班级 (class)" */
  target: string;
  note: string;
  is_tbd: boolean;
}

export interface DecisionSpec {
  title: string;
  rationale: string;
  is_tbd: boolean;
}

export interface EntitySpec {
  /** 文件名去掉 .md,即 student */
  id: string;
  /** H1 标题,如 "学员 Student";若无则回落到 id */
  name: string;
  /** 所属模块名;顶层 entities/ 下为 null(跨模块共享) */
  module: string | null;
  fields: FieldSpec[];
  relations: RelationSpec[];
  decisions: DecisionSpec[];
  markdown: string;
  /** 在哪个 phase 被追加。缺省视为 "planning"(立项期定义)。 */
  added_in_phase?: "planning" | "in-progress" | "live";
  /** 追加日期 YYYY-MM-DD,仅 added_in_phase 非 planning 时写入。 */
  added_at?: string;
  /**
   * 规范层级标记(批次 1' 保留 frontmatter 容错,但本轮不强用)。
   */
  spec_level?: number;
  /**
   * 反馈池条目(从 markdown 的 `## 反馈池` 段解析)。旧文件无该段时为空数组。
   */
  feedback?: Feedback[];
  /**
   * frontmatter 上的"需要 Agent 重新生成"标记。Atlas 在 POST 反馈时自动写 true,
   * 在最后一条反馈被删时自动抹掉;Agent revise 完毕也可以自己删。
   */
  needs_revision?: boolean;
  /**
   * `## 修订记录` 段的每一条(parser 只读不写,Agent revise 时自己追加)。
   * 旧 entity.md 无该段时为空数组。
   */
  revision_log?: string[];
}

export interface TBDItem {
  /** 相对产品目录的来源文件,如 "entities/student.md" 或 "modules/sales/entities/order.md" */
  source: string;
  /** 实体内位置:"字段 parent_id" / "关系 → 家长 (parent)" / "决策 - 家长是否独立实体" */
  location: string;
  /** TBD 项的描述文本 */
  content: string;
}

export interface DecisionRecord extends DecisionSpec {
  /** 所属实体 id */
  entity: string;
  /** 相对产品目录的来源文件 */
  source: string;
}

export interface ModuleSpec {
  /** 模块目录名,如 "sales" */
  name: string;
  /** MODULE.md 的 H1 标题(可选);未填则回落到 name */
  title: string;
  /** MODULE.md 第一段描述,可空 */
  description: string;
  entityCount: number;
  /** frontmatter.id,缺省时等于 name */
  id?: string;
  /** 岗位标签,如 "销售岗" */
  role?: string;
  /** 视觉色枚举 */
  color?: ModuleColor;
  /** 排序,数字越小越靠前 */
  order?: number;
  /** features/ 目录下的功能点数量 */
  featureCount?: number;
  /**
   * 管理模块声明(三层架构的中层 "管理模块",如学员管理/订单管理)。
   * 在 MODULE.md frontmatter 中以 `groups:` 列出。features 通过 `module_group: <id>`
   * 引用其中一项。MODULE.md 未声明 groups 时,feature.module_group 是自由文本。
   */
  groups?: ModuleGroup[];
}

/** 管理模块(三层架构中层)的轻量声明。 */
export interface ModuleGroup {
  /** kebab-case,在该 module 内唯一 */
  id: string;
  /** 显示名(中文) */
  name: string;
  /** 在 module 内的排序 */
  order?: number;
}

export type ModuleColor =
  | "red"
  | "blue"
  | "green"
  | "yellow"
  | "purple"
  | "indigo"
  | "gray";

export interface FeatureClue {
  /** ISO 日期字符串 YYYY-MM-DD */
  date: string;
  content: string;
  /**
   * 关联的 refine 任务 id(若该线索是被 Codex 任务处理过的或正在处理)。
   * 在 md 中以 `[task:tid]` 标记,parse 时识别。Resolved 段一般会带,Pending
   * 段在任务运行/awaiting_review 时也会带。
   */
  task_id?: string;
  /**
   * 关联的 GitHub issue URL(若该线索被提交为 issue)。
   * 在 md 中以 `[issue:#N]` 或 `[issue:url]` 标记,parse 时识别。
   */
  issue_url?: string;
}

export interface FeaturePoint {
  /** 功能点 id (kebab-case) */
  id: string;
  /** 显示名 */
  name: string;
  /** 所属模块 id */
  module: string;
  created_at: string;
  last_refined_at: string | null;
  /** "## 描述" section 正文 */
  description: string;
  /**
   * "## 给决策者" section 正文(决策者视角的白话描述)。
   * 优先展示给校长/学长等决策者审阅,Agent 也读但写功能点 md 时主要参考 description。
   * 缺段 → 空字符串。
   */
  decision_maker_view: string;
  /**
   * frontmatter reviewed_at:决策者标记"已审阅"的日期(YYYY-MM-DD)。
   * 存在 = 已审;不存在 = 待审。删字段即"重新待审"。
   */
  reviewed_at?: string;
  /** 可选审计追溯:谁标的已审。 */
  reviewed_by?: string;
  clues: {
    pending: FeatureClue[];
    resolved: FeatureClue[];
  };
  /** 原始 markdown 正文(不含 frontmatter) */
  markdown: string;
  /** 在哪个 phase 被追加。缺省视为 "planning"。 */
  added_in_phase?: "planning" | "in-progress" | "live";
  /** 追加日期 YYYY-MM-DD,仅 added_in_phase 非 planning 时写入。 */
  added_at?: string;
  /**
   * 规范层级标记(批次 1' 保留 frontmatter 容错,但本轮不强用)。
   */
  spec_level?: number;
  /**
   * 反馈池条目(从 markdown 的 `## 反馈池` 段解析)。旧文件无该段时为空数组。
   */
  feedback?: Feedback[];
  /**
   * frontmatter 上的"需要 Agent 重新生成"标记。Atlas 在 POST 反馈时自动写 true,
   * 在最后一条反馈被删时自动抹掉;Agent revise 完毕也可以自己删。
   */
  needs_revision?: boolean;
  /**
   * `## 修订记录` 段的每一条(parser 只读不写,Agent revise 时自己追加)。
   * 旧 feature.md 无该段时为空数组。
   */
  revision_log?: string[];
  /**
   * 参与该功能点的角色 id 列表(来自全局 RolesRegistry 的 id,kebab-case)。
   * 仅描述"谁参与",不携带状态信息——状态属实体层,角色无状态。
   * frontmatter 上的 id 不在 registry 中时,parser 仍透传但 server 写盘前会拒绝。
   * 旧 feature.md 无 roles 字段时为 undefined / 空数组。
   */
  roles?: string[];
  /**
   * 管理模块 id(v0.0 三层架构的中层归属)。
   * **v0.1 rev3 起废弃**, 由 `capability_id` 取代。parser 仍容错读取, 但 UI 不再用作骨架层。
   * 见 docs/feature-source-contract.md §3.1.1。
   */
  module_group?: string;
  /**
   * **v0.1 rev3 新, 必填(软兼容)** 归属的 Capability id。
   * 引用 `capabilities/<id>.md`。 缺失 → parser 仍加载 + UI 标 ⚠ + l0Linter 警告。
   * 见 docs/capability-contract.md。
   */
  capability_id?: string;
  /**
   * **v0.1 rev3 重命名** 从 `roles` 改为 `actor_ids`。
   * 参与该 function 的 actor id 列表, 引用 `actors/<id>.md`。
   * parser 自动 alias 旧 `roles` 字段到 `actor_ids`(透明转换), 后续应填写 `actor_ids`。
   * 与 `FeaturePoint.roles` 完全等价, parser 同步两者。
   */
  actor_ids?: string[];
  /**
   * 中形态(feature-source-contract §3.2):该 feature 操作的实体规范名清单
   * (PascalCase 同表多名规则)。
   * 派生 Agent 的种子信号;不强制写,缺省 undefined。
   */
  entities_touched?: string[];
  /**
   * 中形态:该 feature 主体实体的归属层。合法值:
   *   - "org"               机构层(跨校区共享)
   *   - "campus"            校区层(硬隔离或软隔离)
   *   - "follows:<Entity>"  跟随另一实体的归属(如 follows:Order)
   *   - "shared"            跨产品共享(走 contracts/)
   * 非合法值仍透传(供未来扩展),UI 显示标 ⚠。
   */
  ownership?: string;
  /**
   * 重形态:`## 字段清单` 段解析结果(5 列表格)。缺段 / 格式错 → undefined。
   */
  fields?: FeatureFieldRow[];
  /**
   * 重形态:`## 状态转移` 段解析结果(4 列表格)。缺段 → undefined。
   */
  state_transitions?: StateTransitionRow[];
  /**
   * 重形态:`## 字段权限` 段解析结果(变长列表格)。缺段 → undefined。
   */
  field_permissions?: FieldPermissionRow[];
}

/* ============================================================
 *  v0.1 rev3 五层骨架 — Actor / Capability / UseCase
 *  见 docs/actor-contract.md / capability-contract.md / usecase-contract.md
 * ============================================================ */

export type ActorType = "internal_user" | "external_user" | "external_system";
export type ActorSource = "user_input" | "agent_suggested" | "inferred_from_function";

/**
 * Actor — 项目级 first-class 角色对象 (`actors/<id>.md`)。
 * 见 docs/actor-contract.md。
 */
export interface Actor {
  id: string;                       // kebab-case, 产品内全局唯一
  name: string;                     // 中文显示名
  type: ActorType;
  source: ActorSource;
  confirmed: boolean;
  code?: string;                    // 可选, 大写代码
  responsibilities?: string;        // 一句话职责摘要
  /** body 原文(供 UI markdown 渲染), 不含 frontmatter */
  body: string;
}

/**
 * ActorWithRefs — Actor + loader 运行时聚合的反向引用。
 * 反向引用 **绝不写回 md frontmatter**(规则 4)。
 */
export interface ActorWithRefs extends Actor {
  related_capability_ids: string[];  // 反查 capability.actor_ids
  related_function_ids: string[];    // 反查 function.actor_ids
  related_usecase_ids: Array<{ function_id: string; usecase_id: string }>;
                                     // 反查 usecase.actor_id
}

export type CapabilityStatus = "draft" | "confirmed";
                                     // MVP-1 二态 (规则 3)
                                     // in_design / implemented 留待后续
export type CapabilityPriority = "P0" | "P1" | "P2";
export type CapabilitySource = "user_input" | "agent_suggested" | "inferred_from_features";

/**
 * Capability — 业务能力 (`capabilities/<id>.md`)。
 * 见 docs/capability-contract.md。
 */
export interface Capability {
  id: string;                       // kebab-case, 产品内全局唯一
  name: string;                     // 动宾短语 (规则 8)
  domain: string;                   // 从预定义池选 (规则 2)
  value_statement: string;          // "谁 + 通过什么 + 达到什么目的"
  actor_ids: string[];              // 真源
  entity_ids: string[];             // 真源 (引用 Entity 规范名)
  priority: CapabilityPriority;
  status: CapabilityStatus;
  source: CapabilitySource;
  confirmed: boolean;
  body: string;                     // ## 业务描述 / ## 关键决策 ...
}

/**
 * CapabilityWithRefs — Capability + 运行时聚合的反向引用。
 */
export interface CapabilityWithRefs extends Capability {
  function_ids: string[];           // 反查 function.capability_id
}

/**
 * UseCase — 业务场景 (`modules/<m>/usecases/<scenario>.md`)。
 * 见 docs/usecase-contract.md。
 */
export interface UseCase {
  id: string;                       // function 内唯一
  module: string;                   // 物理目录
  function_id: string;              // 真源, 裸 id (规则 1)
  actor_id: string;                 // 真源, 主参与者(单数)
  entity_ids?: string[];            // 可选, 默认继承 function.entities_touched
  precondition?: string;
  postcondition?: string;
  source?: "user_input" | "agent_suggested" | "inferred_from_function_name";
  body: string;                     // ## 主流程 / ## 备选流程 / ## 备注 / ## 反馈池 / ## 修订记录
  /** 反馈池条目,由 parseFeedbackSection(body) 解析。 */
  feedback?: Feedback[];
  /** frontmatter 字段:反馈池非空时由 feedbackWriter 自动写 true;Agent revise 完毕自己删。 */
  needs_revision?: boolean;
  /** frontmatter 字段:agent revise 时若发现步骤序列超 12 步等拆分信号,写入建议;用户处理后清除。 */
  split_suggestion?: string;
}

/**
 * Screen — 界面屏 (`modules/<m>/screens/<screen-id>.md`)。
 * v0.1 界面轨基本粒度, 与 usecase 形成 M:N 对齐。
 * 见 docs/screen-contract.md。
 */
export interface ScreenEntityVisibility {
  /** 所有 actor 默认露出的字段(必填) */
  default: string[];
  /** 按 actor id gate 的字段 (可选): { admin: [id_number, contract_amount], ... } */
  role_gated?: Record<string, string[]>;
  /** 派生字段单独列(可选): 来自 entity 字段表中 D 标记的字段 */
  derived_fields?: string[];
}

export interface Screen {
  id: string;                       // kebab-case, module 内唯一
  name: string;                     // 人类可读
  module: string;                   // module id 或 "shared"(跨模块共享屏)
  /**
   * 归属的管理模块(三层中层 group)id, kebab-case。
   * 若所属 module 在 MODULE.md 声明了 `groups`, 必须 ∈ 其中一项 id(校验阻断)。
   * 全局壳 IA 按此键把 screen 归桶到导航树叶子; 缺省则归入兜底未分组。
   */
  group_id?: string;
  usecase_ids: string[];            // 必填至少 1; 单向真源, usecase 不存反查
  /** 字段可见性矩阵: entityName → ScreenEntityVisibility */
  entity_visibility: Record<string, ScreenEntityVisibility>;
  /** Figma / 外链, 可选 */
  prototype_url?: string;
  /** 静态预览图相对路径或 url, 可选 */
  preview_image?: string;
  added_in_phase?: "planning" | "in-progress" | "live";
  added_at?: string;
  body: string;                     // ## 用途 / ## 拆分理由 / ## 信息架构 / ## 字段可见性补充说明 / ## 状态变体 / ## 设计决策 / ## 反馈池
  /** body 反馈池解析 */
  feedback?: Feedback[];
  /** 反馈池非空时自动写 */
  needs_revision?: boolean;
  /** 原型图轨(界面轨视觉产物)出图队列标记 — 置位后进 codex 客户端 drain 会话的待出图队列, submit 回传后清除 */
  needs_prototype?: boolean;
  /** 暂存待审的原型图相对路径 — submit 回传写此处(非 preview_image), 审核通过才升为 preview_image, 打回则丢弃 */
  pending_prototype?: string;
}

export interface ScreenSummary {
  id: string;
  name: string;
  module: string;
  usecase_ids: string[];
  needs_revision?: boolean;
}

/**
 * Screen ↔ UseCase / Entity 反向聚合视图(loader 运行时算, 不入盘)。
 */
export interface ScreenWithRefs extends Screen {
  /** 引用此 screen 的 usecase 走单向真源, 这里反查 — 实际上 screen 引用 usecase, 反向就是 "本 screen 承接的 usecase 列表"(=usecase_ids), 不需要额外字段 */
}

/**
 * Screen 加载时的校验结果。 阻断级 (loader 抛错) 与视图级 (暴露不阻断) 分离。
 */
export interface ScreenValidationIssue {
  level: "error" | "warning";
  screenId: string;
  module: string;
  rule:
    | "usecase-not-found"
    | "entity-not-referenced-by-usecase"
    | "field-not-in-entity-fields-table"
    | "orphan-screen"
    | "group-id-not-in-module"
    | "group-id-missing";
  detail: string;
}

// ─── 全局壳 IA(信息架构 / 导航树)─────────────────────────────────
// 机器可读的导航树快照, 从真源(MODULE.md groups + screen.group_id)组装。
// shell 渲染 / 版本化 / IA 审核闸的输入。手写 IA.md 仅为人读设计稿, 非真源。

/** 导航叶子: 指向一个 screen。 */
export interface IAScreenRef {
  id: string;
  name: string;
}

/** 导航中层: 管理模块(group), 桶内是归属本 group 的 screens。 */
export interface IAGroup {
  id: string;
  name: string;
  order?: number;
  screens: IAScreenRef[];
}

/** 导航顶层: 业务模块, 含其声明的 groups(已归桶)+ 兜底未分组。 */
export interface IAModuleNode {
  id: string;
  name: string;
  color?: ModuleColor;
  order?: number;
  role?: string;
  /** MODULE.md 声明的 groups, 按声明顺序; screens 已按 group_id 归桶。 */
  groups: IAGroup[];
  /** group_id 缺省或不在声明内的 screens(导航兜底位)。 */
  ungrouped: IAScreenRef[];
}

/** 全局壳的 IA 快照(一个产品一棵导航树)。 */
export interface IASnapshot {
  shell_id: string;
  /** v1, v2, … — MODULE.md/group 变更后 bump。 */
  version: string;
  status: "draft" | "frozen";
  /** 组装时间戳(ISO), 由生成器注入。 */
  generated_at: string;
  /** 产品 id。 */
  product: string;
  /** 按 module.order 排序的导航树。 */
  modules: IAModuleNode[];
}

/** IA 两版之间的一条结构差异。 */
export interface IADiffEntry {
  level: "module" | "group" | "screen";
  change: "added" | "removed" | "renamed" | "moved";
  /** 受影响实体 id。 */
  id: string;
  /** 定位路径, 如 "academic" / "academic/score" / "academic/score/score-entry"。 */
  path: string;
  /** 人读说明, 如 "renamed: 旧名 → 新名" / "moved: score → entitlement"。 */
  detail: string;
}

/** 冻结版 IA vs 新组装 IA 的结构差异(IA 审核闸的输入)。 */
export interface IADiff {
  from: string; // 旧 version
  to: string;   // 新 version
  changed: boolean;
  entries: IADiffEntry[];
}

/**
 * 五层骨架的引用完整性 lint 结果 (l0Linter 规则 6 输出)。
 */
export interface ReferenceIntegrityIssue {
  level: "warning";
  rule: "function-missing-capability" | "function-unknown-capability"
      | "capability-unknown-actor" | "capability-unknown-entity"
      | "usecase-unknown-function" | "usecase-unknown-actor";
  source: string;                   // 出错文件相对路径
  detail: string;                   // 具体引用了什么不存在的 id
}

/* ============================================================
 *  Feature 重叠检测(同 module + module_group 桶内可能重复的 feature 组)
 * ============================================================ */

/**
 * GET /api/products/:id/features/overlap-report 中的一组 — 一组互相疑似重叠的 features。
 */
export interface OverlapGroup {
  /** 组 id(组内 feature_ids 排序后的 sha1 前 12 位, 跨次扫描稳定) */
  id: string;
  /** 组成员 */
  features: Array<{ moduleId: string; featureId: string; name: string }>;
  /** 信号说明(实体重合 X% / 名称相似 Y% / 名称高度相似) */
  reasons: string[];
  /** 标准化的 member key(sorted "module/id" join), 用于跟 sidecar overlap-ignored 对账 */
  memberKey: string;
}

export interface OverlapReport {
  groups: OverlapGroup[];
  /** sidecar overlap-ignored.yml 中已驳回的组数 */
  ignored_count: number;
}

/** 重形态 §3.3 `## 字段清单` 段一行 */
export interface FeatureFieldRow {
  name: string;        // 字段名 (snake_case)
  type: string;        // TypeScript 原始类型名 / 枚举名 / Entity ref
  required: boolean;   // ✓ 为 true, - 为 false, 其它视作 false
  constraint: string;  // unique / FK→Entity / enum: a|b|c / regex: ... / default: 0 等
  note: string;        // 自由备注(可引用决策)
}

/** 重形态 §3.3 `## 状态转移` 段一行 */
export interface StateTransitionRow {
  from: string;
  to: string;
  trigger: string;
  role: string;        // RolesRegistry id
}

/** 重形态 §3.3 `## 字段权限` 段一行(变长 - role 数随 features 而变) */
export interface FieldPermissionRow {
  field: string;
  permissions: Record<string, "RW" | "R" | "-">;
}

/** 角色定义(来自 data/roles.yml)。kebab-case id + 中文显示名 + 可选说明。 */
export interface RoleDef {
  id: string;
  name: string;
  note?: string;
}

/** 全局角色注册表(单例,落盘在 data/roles.yml)。 */
export interface RolesRegistry {
  version: number;
  roles: RoleDef[];
}

// v0.1 rev3: 流程图 (Flowchart*) 全部类型已删 — 流程图功能在该版本被砍


/** 功能点列表卡片用,只含轻量字段 */
export interface FeaturePointPreview {
  id: string;
  name: string;
  module: string;
  descriptionPreview: string;
  pendingCount: number;
  resolvedCount: number;
  last_refined_at: string | null;
  /** 顶 3 条 pending 线索内容,每条已截到 80 字。无 pending 时为空数组。 */
  pendingPreview: string[];
  /** 反馈池条目数;markmap 用来给节点贴"有 N 条待处理"标识 */
  feedbackCount: number;
  /** frontmatter needs_revision 快照;markmap 节点上贴 ⚠ */
  needs_revision: boolean;
  /**
   * "## 给决策者" section 正文(从 FeaturePoint 透传)。
   * markmap hover 浮卡用 — 免去二次请求。
   * 缺段 → 空字符串。
   */
  decisionMakerView: string;
  /**
   * frontmatter reviewed_at(YYYY-MM-DD)。存在 = ✅ 已审徽章;不存在 = 待审。
   */
  reviewed_at?: string;
  /**
   * 创建日期(从 frontmatter.created_at 透传)。
   * markmap 用来判定 🆕 徽章(7 天内 + 未审阅 → 新增)。
   */
  created_at: string;
  /** 参与角色的 id 列表(从 frontmatter.roles 透传)。markmap 叶节点用来贴角色名后缀。 */
  roles?: string[];
  /** 管理模块 id(从 frontmatter.module_group 透传)。markmap 用来在 module → feature 中间插入分组节点。 */
  module_group?: string;
  /** 中形态:操作的实体规范名清单(从 frontmatter.entities_touched 透传)。markmap 可贴小角标。 */
  entities_touched?: string[];
  /** 中形态:归属层(从 frontmatter.ownership 透传)。markmap 可贴 [机构]/[校区] 小角标。 */
  ownership?: string;
}

/** 模块 + 其下功能点预览,金字塔视图主数据 */
export interface ModuleWithFeatures {
  module: ModuleSpec;
  features: FeaturePointPreview[];
}

/** 任务队列单条记录(Step 5) */
export type TaskStage =
  | "queued"
  | "running"
  | "awaiting_review"
  | "completed"
  | "rejected"
  | "failed";

/**
 * 任务类型(v0.2b1)。
 * - feature-refine: 旧路径, 单 feature 单文件 .draft 模式 (FeatureDrawer 流程)
 * - feature-revise / usecase-revise / screen-revise: 新 batch 路径, codex workspace-write 多文件
 * - screen-generate: 新 batch 路径, 用 buildScreenGeneratePrompt
 */
export type TaskKind =
  | "feature-refine"
  | "feature-revise"
  | "usecase-revise"
  | "screen-generate"
  | "screen-revise"
  | "actor-revise"
  | "entity-revise"
  | "entity-derive"
  | "feature-generate"
  | "usecase-generate"
  | "conventions-generate"
  // 开发中阶段:决策者自由文本需求 → agent 直接改规格(Session 编排树里的单个 Task 原子)
  | "product-instruct";

/** batch kinds 跑完后, 由 changesetTracker 反推的单条文件变更。 */
export interface ChangedFile {
  /** 相对 productDir 的路径 (POSIX 分隔符) */
  path: string;
  action: "create" | "update" | "delete";
  /** before 内容; create 时为 null */
  before: string | null;
  /** after 内容; delete 时为 null */
  after: string | null;
  /** 单文件级 review 状态; 未指定 = 跟随 task 整体 */
  reviewState?: "pending" | "accepted" | "rejected";
  /** v0.2c §5.5: 业务级摘要 (字段/段级别 diff), changesetTracker 算出来填 */
  summary?: ChangeFileSummary;
}

/** ChangedFile.summary 字段, 由 diffSummarizer 产出。 */
export interface ChangeFileSummary {
  /** 一行业务级文字, 给 ReviewChangesetModal 主显示 */
  line: string;
  added: string[];
  removed: string[];
  changed: string[];
  kind: "field-diff" | "ref-diff" | "section-diff" | "text-diff" | "create" | "delete";
}

export interface BaseTask {
  id: string;
  productId: string;
  kind: TaskKind;
  /** UI 显示名, e.g. "Revise 22 features" 或 feature name */
  title: string;
  stage: TaskStage;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** batch kinds 用; feature-refine 走 .draft 不用 */
  changedFiles?: ChangedFile[];
  /** v0.2c §5.6a: running 中实时 step (codex JSONL 事件抽出) */
  steps?: TaskStep[];
  /** v0.2c §5.6b: 完成时聚合 changedFiles.summary 算的 task 级一句话摘要 */
  summaryLine?: string;
}

/** v0.2c §5.6a: agent 跑过程中的业务级 step. */
export interface TaskStep {
  /** ISO 时间戳 */
  ts: string;
  /** 自然语言文字, e.g. "正在校验 student-intake" / "提议写入 Order.md" */
  label: string;
}

export interface FeatureRefineTask extends BaseTask {
  kind: "feature-refine";
  featureId: string;
  featureName: string;
  moduleName: string;
}

export interface FeatureReviseTask extends BaseTask {
  kind: "feature-revise";
}

export interface UseCaseReviseTask extends BaseTask {
  kind: "usecase-revise";
}

export interface ScreenGenerateTask extends BaseTask {
  kind: "screen-generate";
}

export interface ScreenReviseTask extends BaseTask {
  kind: "screen-revise";
}

export interface ActorReviseTask extends BaseTask {
  kind: "actor-revise";
}

export interface EntityReviseTask extends BaseTask {
  kind: "entity-revise";
}

export interface EntityDeriveTask extends BaseTask {
  kind: "entity-derive";
}

export interface FeatureGenerateTask extends BaseTask {
  kind: "feature-generate";
}

export interface UseCaseGenerateTask extends BaseTask {
  kind: "usecase-generate";
}

export interface ConventionsGenerateTask extends BaseTask {
  kind: "conventions-generate";
}

/**
 * 开发中阶段「需求框 → agent 直接改规格」的单个 Task 原子。
 * 它是 Session 编排树(Session→Task→Plan→Step)里的 Task 层,仍走现有三态闸。
 * - instruction: 决策者自由文本需求(规划器拆分后的"带范围子指令")
 * - sessionId: 所属 Session(树的根);独立入队时为空串
 * - plans: 该 Task 下的 Plan 列表(phase1 恒为 1 个 execute Plan),codex 内部 ReAct = plan.steps
 */
export interface ProductInstructTask extends BaseTask {
  kind: "product-instruct";
  instruction: string;
  sessionId: string;
  plans?: TaskPlan[];
}

export type Task =
  | FeatureRefineTask
  | FeatureReviseTask
  | UseCaseReviseTask
  | ScreenGenerateTask
  | ScreenReviseTask
  | ActorReviseTask
  | EntityReviseTask
  | EntityDeriveTask
  | FeatureGenerateTask
  | UseCaseGenerateTask
  | ConventionsGenerateTask
  | ProductInstructTask;

/** 兼容别名: 旧代码用 RefineTask = FeatureRefineTask */
export type RefineTask = FeatureRefineTask;

// ───────────────────────── Session 编排树(开发中阶段) ─────────────────────────

/** 树节点三态(图:pending 灰 / running 蓝 / finished 绿)。failed 为终态变体。 */
export type NodeState = "pending" | "running" | "finished" | "failed";

/**
 * Plan = Task 内的一次 codex 运行(phase1 恒为 execute)。
 * codex 单次运行内部的 观察→思考→行动→结果 迭代即 steps(复用 TaskStep / onStep)。
 */
export interface TaskPlan {
  id: string;
  kind: "execute" | "validate" | "fix";
  state: NodeState;
  steps: TaskStep[];
  /** 该 Plan 产出的文件变更(phase1 即 Task 的 changedFiles) */
  changedFiles?: ChangedFile[];
}

/**
 * Session = 一次需求框提交(树的根)。规划器把一句话需求拆成 1..N 个 Task。
 * Session 本身不持审核态 — 审核仍在每个子 Task 的三态闸上(memory:不另起平行审核态)。
 */
export interface AgentSession {
  id: string;
  productId: string;
  /** 决策者原始一句话需求 */
  instruction: string;
  state: NodeState;
  createdAt: string;
  /** 子 Task id(= ProductInstructTask.id),顺序即串行执行序 */
  taskIds: string[];
  /** 规划器失败信息(失败则兜底为单 Task) */
  planError?: string | null;
}

/** Session 树视图:Session + 其子 Task 的公开视图(给前端 SessionTreePanel)。 */
export interface AgentSessionTree {
  session: AgentSession;
  tasks: ProductInstructTask[];
}

/**
 * 产品规格层(Layer 2)文件类别。
 * 7 类标准文件,以"产品级横切信息"为主体,Atlas 自 v2 起承载。
 */
export type SpecFileKind =
  | "decisions"
  | "seams"
  | "entities-ownership"
  | "architectural-warnings"
  | "evolution-principles"
  | "ai-requirements"
  | "risks";

/** 产品规格层(Layer 2)单文件读取结果。文件不存在时 exists=false, content="". */
export interface SpecFile {
  kind: SpecFileKind;
  filename: string;
  exists: boolean;
  content: string;
  last_modified: string | null;
}

/**
 * 产品愿景文件(Layer 1)。单文件 VISION.md,自由 markdown。
 * 不结构化解析,概览 tab 在顶部完整渲染。
 */
export interface ProductVision {
  exists: boolean;
  content: string;
  last_modified: string | null;
}

/** 决策状态枚举(per docs/decisions-contract.md §2)。 */
export type DecisionStatus = "active" | "superseded" | "archived";

/** 架构警告状态枚举(per docs/warnings-contract.md)。 */
export type WarningStatus = "待承接" | "部分承接" | "已纳入";

/**
 * 产品级架构警告(ARCHITECTURAL-WARNINGS.md 单文件,H2 章节)。
 * 见 docs/warnings-contract.md。
 */
export interface ArchitecturalWarning {
  /** 形如 "1" / "2" — 警告序号(从 H2 标题提取) */
  id: string;
  /** 一句话标题(H2 标题文本) */
  title: string;
  /** 当前承接状态;默认 "待承接" */
  status: WarningStatus;
  /** **学长原话** 段(允许 quote 块、原始 markdown) */
  originalQuote: string;
  /** **学长原意** / **原意** 段 */
  interpretation: string;
  /** **整体规格承接** 段 */
  resolution: string;
  /** **含义** 段 */
  implication: string;
  /** 完整 markdown body(供 UI 展开显示) */
  body: string;
}

export interface ArchitecturalWarningsData {
  exists: boolean;
  warnings: ArchitecturalWarning[];
  preamble: string;
  last_modified: string | null;
}

/**
 * L0 违规(CONVENTIONS.md 命名 / 字段 / 通用流程 等机械可验证规则的违例)。
 */
export interface L0Violation {
  /** 违规类别 */
  category: "naming" | "missing-frontmatter" | "invalid-reference" | "format";
  /** 违规简短描述 */
  message: string;
  /** 涉及的 source 文件相对路径 */
  source: string;
  /** 严重度:error(必须修) / warn(建议修) */
  severity: "error" | "warn";
  /** 修复建议 */
  suggestion?: string;
}

export interface L0ViolationsData {
  exists: boolean;
  /** 机械化检查的总违规数 */
  total: number;
  violations: L0Violation[];
  /** 生成时间 */
  generated_at: string;
}

/**
 * 产品级决策(DECISIONS.md 单文件,H3 块格式 — 见 docs/decisions-contract.md)。
 * 解析器允许 H3 块为主要形态,fallback 到 legacy 表格行(`| D-NN | 决策 | 理由 |`)
 * 以兼容已有规格快照。
 */
export interface Decision {
  /** 形如 "D-47" — 必须 `D-` 前缀 + 数字 */
  id: string;
  /** ISO 日期 YYYY-MM-DD(无则空字符串) */
  date: string;
  /** 一行标题 */
  title: string;
  /** 默认 active */
  status: DecisionStatus;
  /** 决策摘要(一句话) */
  summary: string;
  /** 受影响的 feature id 清单(逗号列表解析) */
  affectedFeatures: string[];
  /** 来源段引用(如 "SPEC-V1.md §7.3");空字符串表示未填 */
  sourceRef: string;
  /** 块完整 markdown(供 UI 展开渲染) */
  body: string;
}

/**
 * Path C 派生实体(`derived/entities/<Name>.md`)。
 * 见 docs/entity-contract.md。派生只读,UI 不编辑;修改 → 改 source 重派生。
 */
export interface DerivedEntity {
  /** PascalCase 规范名,与文件名(去.md)一致 */
  name: string;
  /** 取自 ENTITIES-OWNERSHIP.md;未声明 → "[TBD]" */
  layer: string;
  /** 取自 ENTITIES-OWNERSHIP.md;未声明 → "[TBD]" */
  maintainers: string;
  /** 派生依据 — feature 路径列表(`modulename/featureid`) */
  sourceFeatures: string[];
  /** 派生依据 — 接缝 id 列表 */
  sourceSeams: string[];
  /** 派生依据 — 决策 id 列表 */
  sourceDecisions: string[];
  /** 生成时间(ISO),取自 frontmatter.generated_at 或文件 mtime */
  generated_at: string | null;
  /** 完整 markdown body(供 UI 展开看字段表 / 状态机 / 等) */
  body: string;
  /** `## 给决策者` H2 段抽出的白话内容(契约 §3.3),无该段则为空字符串 */
  decisionMakerView: string;
  /** 决策者标已审时间(ISO),来自 sidecar review-state.yml;未审为 null */
  reviewedAt: string | null;
  /** 决策者标已审人,来自 sidecar review-state.yml;未审为 null */
  reviewedBy: string | null;
  /** 审阅备注(可选),来自 sidecar review-state.yml */
  reviewerNote: string | null;
}

/**
 * Reconcile 报告(`derived/entities/reconcile-report.md`)。
 * 见 docs/entity-contract.md §4。
 */
export interface EntityReconcileDiff {
  /** 实体规范名 */
  name: string;
  /** 派生侧的描述(可选,声明有派生无 时为空) */
  derivedNote?: string;
  /** 声明侧 layer(可选,派生有声明无 时为空) */
  declaredLayer?: string;
  /** 派生侧 layer(可选,归属不一致 时填) */
  derivedLayer?: string;
  /** 建议处理 */
  suggestion?: string;
}

export interface EntityReconcileReport {
  exists: boolean;
  /** 文件原文(供 UI markdown 渲染) */
  rawMarkdown: string;
  /** 派生有声明无 */
  derivedOnly: EntityReconcileDiff[];
  /** 声明有派生无 */
  declaredOnly: EntityReconcileDiff[];
  /** 归属不一致 */
  layerMismatch: EntityReconcileDiff[];
  last_modified: string | null;
}

/**
 * 派生实体 question(`derived/entities/questions.md`),trigger 模式见 entity-contract §6.3。
 */
export type EntityQuestionStatus = "pending" | "accepted" | "custom" | "rejected";

export interface EntityQuestion {
  feature: string;
  module: string;
  question: string;
  trigger: {
    feature_path: string;
    original_text: string;
  };
  proposed_resolution?: string;
  /** 决策状态(契约 §5.2),跨 GLOBAL-FEEDBACK(accept/custom)与 questions-decisions.yml(reject)合并判定 */
  status: EntityQuestionStatus;
  /** accept → proposed_resolution; custom → 用户填的内容; reject → 驳回原因; pending → undefined */
  resolution?: string;
  /** 决策落地 gfb id(accept/custom 时) */
  resolvedGfbId?: string;
}

/**
 * GET /api/products/:id/entities/derived 响应。
 */
export interface DerivedEntitiesData {
  /** 是否存在 derived/entities/ 目录且非空 */
  exists: boolean;
  entities: DerivedEntity[];
  /** 派生整体生成时间(取目录下最新文件 mtime) */
  generated_at: string | null;
  /** stale:source 文件 mtime > 派生文件 mtime → true */
  stale: boolean;
  stale_reason: string | null;
}

/**
 * GET /api/products/:id/entities/questions 响应。
 */
export interface DerivedEntityQuestionsData {
  exists: boolean;
  questions: EntityQuestion[];
  questions_lint_ok: boolean;
  questions_lint_errors: string[];
}

/**
 * 实体归属表单行(ENTITIES-OWNERSHIP.md `## 完整归属清单` 表格)。
 * 分两种:`group` 是分组分隔行(D 字典层 / A 产品层 / ...),`entity` 是数据行。
 */
export type OwnershipRow = OwnershipGroupRow | OwnershipEntityRow;

export interface OwnershipGroupRow {
  kind: "group";
  /** 分组名(去除粗体标记后),如 "D 字典层" */
  name: string;
}

export interface OwnershipEntityRow {
  kind: "entity";
  /** 实体规范名(PascalCase),如 "Product" / "Order"。从 `EntityName(中文别名)` 提取首段 */
  name: string;
  /** 中文别名(去括号),如 "学员" — 无别名时为空 */
  alias: string;
  /** 归属层 — 自由文本,常用值:机构层 / 校区(硬隔离) / 校区(软隔离) / 跟随 <Entity> / 跨校区 / 本校区 / 可配置 */
  layer: string;
  /** 维护权限文本 */
  maintainers: string;
  /** 备注 — 可引用决策(D-NN) */
  note: string;
}

/**
 * GET /api/products/:id/entities-ownership 的响应数据。
 */
export interface EntitiesOwnershipData {
  exists: boolean;
  /** 解析的所有行(含分组分隔行 + 数据行,保留原始顺序) */
  rows: OwnershipRow[];
  /** `## 完整归属清单` H2 之前的内容(leading comment + H1 + preamble) */
  preamble: string;
  /** `## 完整归属清单` 表格之后的内容(`## 关键派生关系` / `## 跨校区操作的处理原则` 等) */
  trailing: string;
  last_modified: string | null;
}

/**
 * 产品级跨模块接缝契约(SEAMS.md 单文件,H2 章节;见 docs/seams-contract.md)。
 * 阶段 3 保留 SEAMS.md 单文件形态(yunkai-erp 快照即此形态);后续阶段视情况切分到 seams/<id>.md。
 */
export interface Seam {
  /** 接缝编号,形如 "5.3" / "A→B" 等任意字符串 */
  id: string;
  /** 接缝标题(由 H2 行解析) */
  title: string;
  /** 调用方 / 被调用方(可选,从 body 提取) */
  caller: string;
  callee: string;
  /** 触发时机(可选) */
  trigger: string;
  /** 数据契约段(原文,可能含 typescript-like 代码块) */
  dataContract: string;
  /** 异常处理段(原文) */
  exceptions: string;
  /** 接缝完整 markdown body(供 UI 展开渲染) */
  body: string;
}
