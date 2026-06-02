import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { ScreenList } from "../ScreenList";
import { ConceptPromptButton } from "../ConceptPromptButton";

interface DesignTabProps {
  productId: string;
  readOnly?: boolean;
}

/**
 * 双轨设计区(界面轨)。 顶部 = 渲染工作队列监控(Atlas/Claude 出图,取代旧 codex 任务触发)
 * + 「复制概念图指令」(给 codex 出概念参考图)。 主体是 Screen 列表 + 字段可见性 +
 * 原型图审核闸(见 ScreenList)。
 *
 * 规格的生成/更新现由 Claude Code 对话驱动, 不再走 codex batch 按钮(2026-05-31 起)。
 * v0.0 遗留的 design.md 子视图已删。
 */
export function DesignTab({ productId, readOnly = false }: DesignTabProps) {
  return (
    <div className="relative flex min-h-0 flex-col">
      <GlobalFeedbackPanel productId={productId} scope="prototype" />
      <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-5 py-1.5">
        {!readOnly ? <ConceptPromptButton productId={productId} /> : null}
      </div>
      <ScreenList productId={productId} readOnly={readOnly} />
    </div>
  );
}
