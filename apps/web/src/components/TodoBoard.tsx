import { KanbanSquare } from "lucide-react";
import { useProductStore } from "../stores/productStore";

function clean(text: string): string {
  // 去掉 markdown 强调标记(**bold**, *italic*, `code`),todo 行常见 **[重构]** 这种装饰
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}

export function TodoBoard() {
  const products = useProductStore((s) => s.products);
  const selectedId = useProductStore((s) => s.selectedProductId);
  const product = products.find((p) => p.id === selectedId) ?? null;

  if (!product) return null;

  const todos = product.todos;
  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  return (
    <section className="border-b border-slate-200 bg-white p-6">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KanbanSquare size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-950">待办看板</h2>
        </div>
        <span className="text-xs text-slate-500">
          {open.length} 待办 · {done.length} 已完成
        </span>
      </header>

      {todos.length === 0 ? (
        <div className="rounded-md border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          STATUS.md 中暂无待办
        </div>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {open.map((t, i) => (
            <li key={`open-${i}`} className="flex items-start gap-2 text-slate-900">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <span className="leading-6">{clean(t.text)}</span>
            </li>
          ))}
          {done.map((t, i) => (
            <li key={`done-${i}`} className="flex items-start gap-2 text-slate-400 line-through">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden />
              <span className="leading-6">{clean(t.text)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
