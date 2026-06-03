/**
 * Phase 4 验收:render 链路对"缺内容"的屏自动 spawn claude 生成真内容(非桩)。
 * 拿一个已有屏,备份其 content html → 删掉(模拟缺失)→ 调真服务 generateScreenContent
 * → 确认产出非桩 → 还原备份(content/ 是 gitignored,但仍精确还原避免副作用)。
 */
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { generateScreenContent, isStubOrMissing } from "../apps/api/src/services/screenContentGen";

const pid = "yunkai-erp";
const mod = "academic";
const sid = "entitlement-touch-monitor";

async function main() {
  const cp = path.resolve("data/products", pid, "shells/v1/content", `${sid}.html`);
  const bak = `${cp}.verify-bak`;
  if (!existsSync(cp)) throw new Error(`前置:${cp} 不存在,换一个屏`);
  await fs.copyFile(cp, bak);
  await fs.unlink(cp); // 模拟"缺内容"
  console.log(`✓ 已移走 ${sid} 的 content(模拟缺失),isStubOrMissing=${isStubOrMissing(cp)}`);

  console.log("→ generateScreenContent(spawn claude headless)… 可能需 1-4 分钟");
  const res = await generateScreenContent(pid, mod, sid);
  console.log("res:", res);

  const produced = existsSync(cp);
  const stub = isStubOrMissing(cp);
  const len = produced ? (await fs.readFile(cp, "utf8")).length : 0;

  // 还原备份(覆盖 claude 生成的文件,精确恢复原内容)
  await fs.rename(bak, cp);
  console.log(`✓ 已还原 ${sid} 的原 content`);

  if (!res.ok || !res.real || !produced || stub) {
    throw new Error(`claude 未产出真内容: ok=${res.ok} real=${res.real} produced=${produced} stub=${stub}`);
  }
  console.log(`\nPHASE 4 claude 内容链路: ALL GOOD ✅ (生成真内容 ${len} 字节, 非桩)`);
}

main().catch((e) => {
  console.error("\nPHASE 4 VERIFY FAILED ❌\n", e);
  process.exit(1);
});
