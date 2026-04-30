import { Palette } from "lucide-react";
import { ComingSoonCard } from "./ComingSoonCard";

export function DesignTrack() {
  return (
    <ComingSoonCard
      description="未来按 data/designs/<product-id>/ 组织 PRD、原型说明和设计决策 markdown，提供独立的设计轨道视图，不与产品详情混在一起。"
      icon={Palette}
      title="双轨设计区"
    />
  );
}
