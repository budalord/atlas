import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { ScreenList } from "../ScreenList";
import { ConceptPromptButton } from "../ConceptPromptButton";
import { AgentTaskTriggers } from "../AgentTaskTriggers";

interface DesignTabProps {
  productId: string;
  readOnly?: boolean;
}

/**
 * 双轨设计区(界面轨)。 顶部统一动作条:生成/更新界面规格(codex 反推屏规格,规格轨)
 * + 复制概念图指令(给 codex 出概念参考图)。 渲染/出图状态收编到顶部「Agent 活动」条。
 * 主体是 Screen 列表 + 字段可见性 + 原型图审核闸(见 ScreenList)。
 * v0.0 遗留的 design.md 子视图已删。
 */
export function DesignTab({ productId, readOnly = false }: DesignTabProps) {
  return (
    <div className="relative flex min-h-0 flex-col">
      <GlobalFeedbackPanel productId={productId} scope="prototype" />
      <div className="flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-5 py-1.5">
        {!readOnly ? (
          <>
            <AgentTaskTriggers
              productId={productId}
              triggers={[
                { label: "生成界面规格", kinds: ["screen-generate"] },
                { label: "更新界面规格", kinds: ["screen-revise"] }
              ]}
            />
            <ConceptPromptButton productId={productId} />
          </>
        ) : null}
      </div>
      <ScreenList productId={productId} readOnly={readOnly} />
    </div>
  );
}
