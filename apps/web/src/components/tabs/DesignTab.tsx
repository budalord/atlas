import { GlobalFeedbackPanel } from "../GlobalFeedbackPanel";
import { ScreenList } from "../ScreenList";
import { AgentTaskTriggers } from "../AgentTaskTriggers";

interface DesignTabProps {
  productId: string;
  readOnly?: boolean;
}

/**
 * 双轨设计区(界面轨)。 顶部「生成屏幕 / 更新屏幕」触发 codex batch 反推/修订 Screen 规格,
 * 主体是 Screen 列表 + 字段可见性 + 原型图审核闸(见 ScreenList)。
 *
 * v0.0 遗留的 design.md 子视图已在此版本删除(从未承载真实文档)。
 */
export function DesignTab({ productId, readOnly = false }: DesignTabProps) {
  return (
    <div className="relative flex min-h-0 flex-col">
      <GlobalFeedbackPanel productId={productId} scope="prototype" />
      <div className="flex items-center justify-end border-b border-slate-200 bg-slate-50 px-5 py-1.5">
        {!readOnly ? (
          <AgentTaskTriggers
            productId={productId}
            triggers={[
              { label: "生成界面规格", kinds: ["screen-generate"] },
              { label: "更新界面规格", kinds: ["screen-revise"] }
            ]}
          />
        ) : null}
      </div>
      <ScreenList productId={productId} readOnly={readOnly} />
    </div>
  );
}
