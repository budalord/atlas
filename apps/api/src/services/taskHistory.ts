import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Task } from "@atlas/shared";

/**
 * v0.2c §5.6c: task 终态时把摘要追加到 ~/.atlas/products/<id>/task-history.jsonl,
 * 给 RecentActivityStrip 跨任务累积视角用。
 *
 * 与产品数据 (data/products/<id>/) 分离, 避免污染 SoT 目录。 yunkai-erp 等
 * 不入 git 的产品本来 history 也跨机器不同步, 没问题。
 */

export interface TaskHistoryRecord {
  id: string;
  productId: string;
  kind: string;
  stage: "completed" | "rejected" | "failed";
  title: string;
  summaryLine?: string;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** 各 scope 文件改动数, 来自 changedFiles 聚合 */
  scopeCounts?: Record<string, number>;
  /** schema 校验拦截次数 (来自 step 解析, 暂留扩展) */
  schemaRejects?: number;
}

function historyDir(productId: string): string {
  return path.join(os.homedir(), ".atlas", "products", productId);
}

function historyPath(productId: string): string {
  return path.join(historyDir(productId), "task-history.jsonl");
}

export async function appendTaskHistory(record: TaskHistoryRecord): Promise<void> {
  const dir = historyDir(record.productId);
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify(record) + "\n";
  await fs.appendFile(historyPath(record.productId), line, "utf8");
}

/**
 * 查询 history, 按时间倒序返最近 N 天 (默认 7).
 */
export async function queryTaskHistory(
  productId: string,
  sinceDays: number = 7
): Promise<TaskHistoryRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(historyPath(productId), "utf8");
  } catch {
    return [];
  }
  const cutoff = Date.now() - sinceDays * 24 * 3600 * 1000;
  const records: TaskHistoryRecord[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as TaskHistoryRecord;
      const tsRaw = r.finishedAt ?? r.startedAt ?? r.enqueuedAt;
      const ts = tsRaw ? Date.parse(tsRaw) : NaN;
      if (Number.isFinite(ts) && ts >= cutoff) records.push(r);
    } catch {
      // skip bad line
    }
  }
  return records.sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
}

export interface HistorySummary {
  count: number;
  byStage: Record<string, number>;
  byScope: Record<string, number>;
  schemaRejects: number;
}

export async function summarizeHistory(
  productId: string,
  sinceDays: number = 7
): Promise<HistorySummary> {
  const records = await queryTaskHistory(productId, sinceDays);
  const summary: HistorySummary = { count: records.length, byStage: {}, byScope: {}, schemaRejects: 0 };
  for (const r of records) {
    summary.byStage[r.stage] = (summary.byStage[r.stage] ?? 0) + 1;
    summary.schemaRejects += r.schemaRejects ?? 0;
    if (r.scopeCounts) {
      for (const [scope, n] of Object.entries(r.scopeCounts)) {
        summary.byScope[scope] = (summary.byScope[scope] ?? 0) + n;
      }
    }
  }
  return summary;
}

/** 从 Task + ChangedFiles 构造 history record, 给 taskQueue 终态时调用. */
export function buildHistoryRecord(
  task: Task,
  stage: "completed" | "rejected" | "failed"
): TaskHistoryRecord {
  const scopeCounts: Record<string, number> = {};
  for (const f of task.changedFiles ?? []) {
    const m = f.path.match(/\/(features|entities|usecases|screens|actors)\//);
    const scope = m?.[1] ?? "other";
    scopeCounts[scope] = (scopeCounts[scope] ?? 0) + 1;
  }
  return {
    id: task.id,
    productId: task.productId,
    kind: task.kind,
    stage,
    title: task.title,
    summaryLine: (task as Task & { summaryLine?: string }).summaryLine,
    enqueuedAt: task.enqueuedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    error: task.error,
    scopeCounts: Object.keys(scopeCounts).length > 0 ? scopeCounts : undefined,
    schemaRejects: undefined
  };
}
