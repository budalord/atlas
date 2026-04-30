import type { IntakeStage } from "../types";

interface IntakeProgressProps {
  stage: IntakeStage;
}

export function stageNumber(stage: IntakeStage): 1 | 2 | 3 | 4 {
  if (stage === "stage1") return 1;
  if (stage === "stage2" || stage === "stage2-pending") return 2;
  if (stage === "stage3") return 3;
  return 4; // finalized or done
}

export function stageLabel(stage: IntakeStage): string {
  switch (stage) {
    case "stage1":
      return "1/3 · 待发现";
    case "stage2":
      return "2/3 · 待访谈";
    case "stage2-pending":
      return "2/3 · 等待你回答 INTERVIEW";
    case "stage3":
      return "3/3 · 待沉淀";
    case "finalized":
      return "完成 · 待归档";
    case "done":
      return "已归档";
  }
}

export function IntakeProgress({ stage }: IntakeProgressProps) {
  const n = stageNumber(stage);
  const percent = Math.min(100, (n / 4) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
        <span>{stageLabel(stage)}</span>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-cyan-600 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
