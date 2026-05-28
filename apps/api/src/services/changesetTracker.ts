import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChangedFile } from "@atlas/shared";
import { inferScopeFromPath, summarizeChange } from "./diffSummarizer";

/**
 * v0.2b1 changeset 跟踪: codex workspace-write 直接落盘前后, 用 mtime + content
 * snapshot 反推 changedFiles[], 并把原内容 stage 到 .atlas-staging/<taskId>/<path>
 * 作为 reject 时的回滚来源。
 *
 * 设计:
 * - per-task backup dir 隔离, 防多个 awaiting_review task 互相覆盖
 * - 仅处理 .md 文件(yunkai-erp 范围内 SoT 都是 markdown)
 * - 排除 .atlas-staging / .draft / 隐藏目录 / node_modules
 */

const STAGING_DIR = ".atlas-staging";

export interface FileSnapshot {
  mtimeMs: number;
  content: string;
}

export type Snapshot = Map<string, FileSnapshot>;

/** 递归列出 productDir 内所有 .md 文件 (相对路径, POSIX 分隔). */
async function walkMarkdown(productDir: string): Promise<string[]> {
  const out: string[] = [];
  async function visit(absDir: string, relDir: string) {
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const name = e.name;
      if (name.startsWith(".")) continue; // 隐藏目录/文件 (含 .atlas-staging, .git)
      if (name === "node_modules") continue;
      const abs = path.join(absDir, name);
      const rel = relDir ? `${relDir}/${name}` : name;
      if (e.isDirectory()) {
        await visit(abs, rel);
      } else if (e.isFile() && name.endsWith(".md") && !name.endsWith(".draft")) {
        out.push(rel);
      }
    }
  }
  await visit(productDir, "");
  return out;
}

/** 在 codex 跑之前, snapshot 全部 .md 的 mtime + content。 */
export async function snapshotProductFiles(productDir: string): Promise<Snapshot> {
  const files = await walkMarkdown(productDir);
  const snap: Snapshot = new Map();
  await Promise.all(
    files.map(async (rel) => {
      const abs = path.join(productDir, rel);
      try {
        const stat = await fs.stat(abs);
        const content = await fs.readFile(abs, "utf8");
        snap.set(rel, { mtimeMs: stat.mtimeMs, content });
      } catch {
        // 文件读不到, 跳过
      }
    })
  );
  return snap;
}

/**
 * codex 跑完后, 对比 snapshot 反推 changedFiles。
 * - before 集中有 + 现 walk 找不到 → delete
 * - before 集中无 + 现 walk 找到   → create
 * - 都有但 mtime 不等             → update
 */
export async function diffSnapshot(
  before: Snapshot,
  productDir: string
): Promise<ChangedFile[]> {
  const files = await walkMarkdown(productDir);
  const seen = new Set<string>();
  const result: ChangedFile[] = [];

  for (const rel of files) {
    seen.add(rel);
    const abs = path.join(productDir, rel);
    let mtimeMs: number;
    let after: string;
    try {
      const stat = await fs.stat(abs);
      mtimeMs = stat.mtimeMs;
      after = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    const prev = before.get(rel);
    if (!prev) {
      result.push({ path: rel, action: "create", before: null, after, summary: summarize(rel, null, after) });
    } else if (prev.mtimeMs !== mtimeMs && prev.content !== after) {
      result.push({ path: rel, action: "update", before: prev.content, after, summary: summarize(rel, prev.content, after) });
    }
  }

  // delete: snapshot 有但现在 walk 没有
  for (const [rel, snap] of before) {
    if (!seen.has(rel)) {
      result.push({ path: rel, action: "delete", before: snap.content, after: null, summary: summarize(rel, snap.content, null) });
    }
  }

  return result;
}

/** v0.2c §5.5: 给每个 ChangedFile 算业务级摘要 */
function summarize(relPath: string, before: string | null, after: string | null) {
  const scope = inferScopeFromPath(relPath);
  // 从文件名 (PascalCase entity / kebab-case 其他) 取 id 给 parser 当 hint
  const id = path.basename(relPath, ".md");
  try {
    return summarizeChange(scope, before, after, id);
  } catch {
    return undefined;
  }
}

function stagingPath(productDir: string, taskId: string, relPath: string): string {
  return path.join(productDir, STAGING_DIR, taskId, relPath);
}

/**
 * 把 changedFiles 的 before 内容写到 .atlas-staging/<taskId>/<path>。
 * - update / delete: 写 before 内容
 * - create: 不写 (reject 时只需删原文件, 没 before 可恢复)
 */
export async function stageBackups(
  productDir: string,
  taskId: string,
  files: ChangedFile[]
): Promise<void> {
  await Promise.all(
    files.map(async (f) => {
      if (f.before === null) return; // create, 无 backup
      const dest = stagingPath(productDir, taskId, f.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, f.before, "utf8");
    })
  );
}

/**
 * reject 时回滚:
 * - update → 读 backup, 写回原位置
 * - create → 删原文件 (无 backup 可读)
 * - delete → 读 backup, 重建原文件
 */
export async function restoreFromBackups(
  productDir: string,
  taskId: string,
  files: ChangedFile[]
): Promise<void> {
  for (const f of files) {
    const abs = path.join(productDir, f.path);
    if (f.action === "create") {
      await fs.unlink(abs).catch(() => undefined);
    } else {
      // update / delete: 从 staging 读
      const src = stagingPath(productDir, taskId, f.path);
      try {
        const backup = await fs.readFile(src, "utf8");
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, backup, "utf8");
      } catch {
        // backup 丢了 — 走 ChangedFile.before 兜底
        if (f.before !== null) {
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, f.before, "utf8");
        }
      }
    }
  }
  await clearBackups(productDir, taskId).catch(() => undefined);
}

/** approve / 收尾时清理本 task 的 staging 目录。 */
export async function clearBackups(productDir: string, taskId: string): Promise<void> {
  const dir = path.join(productDir, STAGING_DIR, taskId);
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * 单文件级 reject: 把 file 从 task.changedFiles 标 rejected 后, 用 backup 回滚单条。
 * 这里只做 fs 层操作, 不动 task 状态。
 */
export async function restoreSingleFile(
  productDir: string,
  taskId: string,
  file: ChangedFile
): Promise<void> {
  await restoreFromBackups(productDir, taskId, [file]);
}
