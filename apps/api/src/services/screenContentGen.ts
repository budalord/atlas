/**
 * 屏内容区自动生成(后端 spawn Claude Code 无头会话)。
 *
 * "垫桩不是终点": 渲染前若屏没有真内容, 由本服务 spawn `claude -p` 把 spec → 真内容区 HTML,
 * 再交给渲染。等价于把"派 subagent 手搓内容"自动化。授权走 keychain(同用户), 无需 API key。
 *
 * 失败兜底: 生成失败时回退到桩(流程不中断), 但正常路径产出真内容。退桩时会 console.warn 点明原因。
 *
 * 分工(codex vs claude):
 * - codex(codexRunner): 跑规格/代码改动(workspace-write 多文件 batch + code-instruct)与参考图轨。
 * - claude(本文件): 跑每页原型图内容区 HTML 的"手搓自动化"(spec → 真内容 → 渲染出图)。
 * 两者都是后端 headless spawn,各自独立调用点;claude exec 由 findClaudeExec() 解析。
 */

import { promises as fs } from "node:fs";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { DATA_ROOT } from "./fileReader";

const atlasRoot = path.resolve(DATA_ROOT, "..");

/**
 * 发现 Claude Code 可执行文件。优先级:
 * 1. CLAUDE_CODE_EXECPATH 环境变量
 * 2. Claude 桌面 App bundled 的 claude-code(版本目录取最新)
 * 3. PATH 上的 `claude`(npm i -g @anthropic-ai/claude-code 等独立安装)
 * 找不到返回 null。
 */
function findClaudeExec(): string | null {
  if (process.env.CLAUDE_CODE_EXECPATH && existsSync(process.env.CLAUDE_CODE_EXECPATH)) {
    return process.env.CLAUDE_CODE_EXECPATH;
  }
  const base = path.join(os.homedir(), "Library", "Application Support", "Claude", "claude-code");
  try {
    const versions = readdirSync(base)
      .filter((v: string) => /^\d/.test(v))
      .sort((a: string, b: string) => b.localeCompare(a, undefined, { numeric: true }));
    for (const v of versions) {
      const p = path.join(base, v, "claude.app", "Contents", "MacOS", "claude");
      if (existsSync(p)) return p;
    }
  } catch {
    /* base 不存在 */
  }
  // PATH 兜底:claude CLI 独立装在 PATH 上
  try {
    const p = execFileSync("which", ["claude"], { encoding: "utf8" }).trim();
    if (p && existsSync(p)) return p;
  } catch {
    /* 不在 PATH */
  }
  return null;
}

/** 该内容文件是不是"桩"(或缺失)。 */
export function isStubOrMissing(contentPath: string): boolean {
  if (!existsSync(contentPath)) return true;
  try {
    const txt = readFileSync(contentPath, "utf8");
    return txt.includes("桩内容 · 字段源自 entity_visibility");
  } catch {
    return true;
  }
}

function buildPrompt(productId: string, moduleName: string, screenId: string): string {
  const specRel = `data/products/${productId}/modules/${moduleName}/screens/${screenId}.md`;
  const outRel = `data/products/${productId}/shells/v1/content/${screenId}.html`;
  const refRel = `data/products/${productId}/shells/v1/content/academic-student-profile.html`;
  return [
    `为「云开教育ERP」(教培行业)手搓一个页面的内容区 HTML。`,
    `任务: 读规格 ${specRel}, 产出内容区 HTML 写到 ${outRel}(若已存在则覆盖)。`,
    `先读: 规格(看 ## 信息架构 / ## 状态变体 / frontmatter 的 entity_visibility) + 风格基准 ${refRel}。`,
    `硬规则:`,
    `1. 只写内容区(注入壳 .content 槽位), 绝不写左侧导航/顶栏/面包屑/AppShell。`,
    `2. 复用壳 CSS 变量(--card --border --text-main --text-sub --text-muted --primary --body-bg), class 加页面前缀避免冲突。`,
    `3. 严格照 ## 信息架构 分区; 字段只用 entity_visibility 声明的, 不发明。`,
    `4. 取 loaded 态。样例数据: 教培行业、明显虚构, 严禁真实客户数据。`,
    `5. 视觉对齐参考页(卡片式、12-13px 字号、圆角 10px、清爽), 按页面性质选表格/表单/卡片。`,
    `6. 画布: 宽约 1244px、高约 820px, 一屏放得下。`,
    `只写文件, 完成后回一句话说明布局。`
  ].join("\n");
}

export interface ContentGenResult {
  ok: boolean;
  real: boolean;
  detail: string;
}

const GEN_TIMEOUT_MS = 600_000; // 10min — claude 画复杂屏可能 >4min, 给足以免误兜底桩

/**
 * spawn claude -p 生成该屏真内容区。**异步**(不阻塞 api 事件循环), 超时杀进程。
 * 返回是否成功 + 是否产出了真内容。
 */
export function generateScreenContent(
  productId: string,
  moduleName: string,
  screenId: string
): Promise<ContentGenResult> {
  const exec = findClaudeExec();
  if (!exec) return Promise.resolve({ ok: false, real: false, detail: "找不到 Claude Code 可执行文件" });

  const prompt = buildPrompt(productId, moduleName, screenId);
  const contentPath = path.join(atlasRoot, "data", "products", productId, "shells", "v1", "content", `${screenId}.html`);

  return new Promise((resolve) => {
    const child = spawn(exec, ["-p", prompt, "--permission-mode", "acceptEdits", "--model", "sonnet"], {
      cwd: atlasRoot,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr?.on("data", (d) => { stderr += String(d); });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill("SIGKILL"); } catch { /* noop */ } }, GEN_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: existsSync(contentPath), real: !isStubOrMissing(contentPath), detail: `spawn 错误: ${e.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const real = !isStubOrMissing(contentPath);
      const detail = real
        ? "已生成真内容"
        : timedOut
          ? `超时 ${GEN_TIMEOUT_MS / 1000}s 被杀`
          : `未产出真内容 (code ${code}) ${stderr.slice(0, 150)}`;
      resolve({ ok: existsSync(contentPath), real, detail });
    });
  });
}

/** 确保真内容: 缺/桩则生成; 生成失败回退桩(由调用方写)。返回是否已是真内容。 */
export async function ensureRealContent(
  productId: string,
  moduleName: string,
  screenId: string
): Promise<boolean> {
  const contentPath = path.join(atlasRoot, "data", "products", productId, "shells", "v1", "content", `${screenId}.html`);
  if (!isStubOrMissing(contentPath)) return true; // 已有真内容
  await fs.mkdir(path.dirname(contentPath), { recursive: true });
  const res = await generateScreenContent(productId, moduleName, screenId);
  if (!res.real) {
    // 显式日志:消除"静默退桩"。调用方会写桩兜底,但这里点明 claude 没产出真内容的原因。
    console.warn(`[screen-content] ${moduleName}/${screenId} 退化到桩 — claude 未产出真内容: ${res.detail}`);
  }
  return res.real;
}
