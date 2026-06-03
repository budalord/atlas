import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentSessionTree } from "@atlas/shared";

/**
 * 编排树持久化(改造 5)。把 Session 树(session + 其 Task/Plan/Step/changedFiles)落盘到
 * ~/.atlas/products/<id>/sessions/<sessionId>.json,API 重启能读回未完成的编排树续跑/续审。
 *
 * 照 taskHistory.ts 写法:与产品 SoT(data/products/<id>/)分离,best-effort,失败不影响主流程。
 * 单文件一 Session,落的是 AgentSessionTree(InstructTask 公开视图已含 instruction/sessionId/repoDir,
 * 足以在重启时重建 InternalTask;productDir 可由 productId 推回)。
 */

function sessionsDir(productId: string): string {
  return path.join(os.homedir(), ".atlas", "products", productId, "sessions");
}

function sessionPath(productId: string, sessionId: string): string {
  return path.join(sessionsDir(productId), `${sessionId}.json`);
}

/** 落盘一棵 Session 树(覆盖写)。best-effort。 */
export async function persistTree(tree: AgentSessionTree): Promise<void> {
  const productId = tree.session.productId;
  try {
    await fs.mkdir(sessionsDir(productId), { recursive: true });
    await fs.writeFile(sessionPath(productId, tree.session.id), JSON.stringify(tree), "utf8");
  } catch (e) {
    console.warn(`persistTree failed for session ${tree.session.id}:`, e);
  }
}

/** 删除某 Session 的落盘文件(整树被清理时用)。 */
export async function deletePersistedTree(productId: string, sessionId: string): Promise<void> {
  await fs.rm(sessionPath(productId, sessionId), { force: true }).catch(() => undefined);
}

/** 启动时读回全部产品的全部 Session 树。坏文件跳过。 */
export async function loadAllTrees(): Promise<AgentSessionTree[]> {
  const base = path.join(os.homedir(), ".atlas", "products");
  const out: AgentSessionTree[] = [];
  let productDirs: string[];
  try {
    productDirs = await fs.readdir(base);
  } catch {
    return out; // ~/.atlas/products 不存在 → 无可恢复
  }
  for (const pid of productDirs) {
    const dir = sessionsDir(pid);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, f), "utf8");
        const tree = JSON.parse(raw) as AgentSessionTree;
        if (tree?.session?.id) out.push(tree);
      } catch {
        // skip bad file
      }
    }
  }
  return out;
}
