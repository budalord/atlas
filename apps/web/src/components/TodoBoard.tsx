import { KanbanSquare } from "lucide-react";
import { ComingSoonCard } from "./ComingSoonCard";

export function TodoBoard() {
  return (
    <ComingSoonCard
      description="未来从各产品 STATUS.md 的待办、阻塞和优先级中聚合出今日聚焦看板，按产品和优先级分列展示，不修改源文件。"
      icon={KanbanSquare}
      title="待办看板"
    />
  );
}
