export type ProductTheme = "seo" | "erp" | "miniapp" | "tool";

export type ProductStatus = "discovering" | "in-progress" | "paused" | "live" | "archived";

export type FeatureStatus = "todo" | "doing" | "done" | "blocked" | string;

export type Priority = "P0" | "P1" | "P2" | "P3" | string;

export interface ProductMeta {
  id: string;
  name: string;
  theme: ProductTheme;
  status: ProductStatus;
  tech_stack: string[];
  source_path: string;
  deploy_url: string | null;
  created_at: string;
  tagline?: string | null;
  /** GitHub 仓库标识,例如 "owner/name" 或完整 URL。未填则关闭 GitHub 集成。 */
  repo?: string | null;
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
