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

/**
 * 决策者流程图(per-module 切分版)· 单个 module 的数据。
 * 对应文件 data/products/{id}/derived/flowcharts/by-module/{moduleId}.mmd
 */
export interface ModuleFlowchartData {
  moduleId: string;
  moduleName: string;
  moduleTitle: string | null;
  /** 该模块下的 feature 总数(参考 — 帮 UI 显示) */
  featureCount: number;
  /** mmd 文件内容;exists=false 时为 null */
  mermaid: string | null;
  exists: boolean;
  /** "%% 生成时间: <iso>" 头部或文件 mtime */
  generated_at: string | null;
  /** features/*.md 或 MODULE.md 的最大 mtime > .mmd mtime → stale */
  stale: boolean;
  stale_reason: string | null;
}

/**
 * 决策者流程图列表 + 聚合 questions。
 * 对应 GET /api/products/:id/flowcharts/by-module
 */
export interface ModuleFlowchartListData {
  /** 按 modules 顺序排列的每模块状态 */
  modules: ModuleFlowchartData[];
  /** 聚合 by-module/questions.md;空数组 = 无 questions */
  questions: FlowchartQuestion[];
  questions_lint_ok: boolean;
  questions_lint_errors: string[];
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
 * 派生实体 question(`derived/entities/questions.md`),trigger 模式与 flowchart-contract §6.3 一致。
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
