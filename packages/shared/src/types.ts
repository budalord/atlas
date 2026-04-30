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
