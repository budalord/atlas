import { Sparkles } from "lucide-react";
import { ComingSoonCard } from "./ComingSoonCard";

export function AICatalog() {
  return (
    <ComingSoonCard
      description="未来在 data/ai-touchpoints/ 记录每个 AI 触点的所属产品、输入、输出、风险和依赖模型，集中管理 AI 功能点。"
      icon={Sparkles}
      title="AI 触点管理"
    />
  );
}
