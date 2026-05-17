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
   * 老产品(legacy-id/example-erp/atlas/erp)可缺失,UI 兜底用 tagline 或空字符串。
   */
  description?: string;
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
   * 管理模块 id(三层架构的中层归属)。引用所属 module 的 frontmatter.groups[].id。
   * 父 MODULE.md 未声明 groups 时,该字段是自由文本;声明时,parser 仍透传但
   * UI 显示侧可标"未在 module 声明的 group"。空/缺省 → 该 feature 直接挂在 module 下
   * (markmap 渲染"未分组"占位组)。
   */
  module_group?: string;
  /**
   * 中形态(feature-source-contract §3.2):该 feature 操作的实体规范名清单
   * (per flowchart-contract §3.4,PascalCase 同表多名规则)。
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

/** main.questions.md 中一条 question 的结构(见 flowchart contract §6.3.3)。 */
export interface FlowchartQuestion {
  feature: string;
  module: string;
  question: string;
  trigger: {
    feature_path: string;
    original_text: string;
  };
  proposed_resolution?: string;
}

/** GET /api/products/:id/flowchart 的响应 data 字段。 */
export interface FlowchartData {
  /** main.mmd 内容;exists=false 时为 null */
  mermaid: string | null;
  /** main.mmd 的"%% Generated at: <iso>"头部 / 退化到文件 mtime;不存在时 null */
  generated_at: string | null;
  /** main.mmd 是否存在 */
  exists: boolean;
  /** features/roles.yml 中是否有比 main.mmd 更新的 mtime */
  stale: boolean;
  /** stale=true 时说明是谁让它过期(featureId / "roles.yml") */
  stale_reason: string | null;
  /** main.questions.md 解析后的 question 数组;文件不存在或解析失败 → 空数组 */
  questions: FlowchartQuestion[];
  /** trigger lint 全部通过 → true;有一条失败 → false */
  questions_lint_ok: boolean;
  /** lint 失败条目的诊断;每条形如 "feature: xxx — trigger.original_text 在 feature_path 中 grep 不到" */
  questions_lint_errors: string[];
}

/** 设计文档:每个 feature 1:1 对应一个 markdown 文件 */
export interface DesignSummary {
  name: string;
  last_modified: string | null;
}

export interface DesignDoc {
  name: string;
  body: string;
  last_modified: string | null;
}

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

export interface RefineTask {
  id: string;
  productId: string;
  featureId: string;
  featureName: string;
  stage: TaskStage;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}
