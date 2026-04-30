import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IntakeForm } from "../components/IntakeForm";
import { IntakeProgress, stageLabel } from "../components/IntakeProgress";
import { useIntakeStore } from "../stores/intakeStore";

export function IntakeHome() {
  const list = useIntakeStore((s) => s.list);
  const fetchList = useIntakeStore((s) => s.fetchList);
  const error = useIntakeStore((s) => s.error);
  const navigate = useNavigate();

  useEffect(() => {
    void fetchList();
    const events = new EventSource("/api/events");
    events.addEventListener("data-change", () => {
      void fetchList();
    });
    return () => events.close();
  }, [fetchList]);

  return (
    <main className="min-h-0 overflow-auto bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-950">录入</h1>
          <p className="mt-1 text-sm text-slate-600">从无到有把一个产品录入 Atlas:发现 → 访谈 → 沉淀。</p>
        </div>

        <IntakeForm onCreated={(item) => navigate(`/intake/${item.id}`)} />

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        ) : null}

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-950">正在录入 ({list.length})</h2>
          {list.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
              暂无正在录入的产品。点击上方"新建录入"开始。
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((item) => (
                <Link
                  className="block rounded-md border border-slate-200 bg-white p-4 transition hover:border-slate-400"
                  key={item.id}
                  to={`/intake/${item.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">{item.name}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{item.id}</div>
                    </div>
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{item.theme}</span>
                  </div>
                  <p className="mt-2 truncate font-mono text-[11px] text-slate-500" title={item.source_path}>
                    {item.source_path}
                  </p>
                  <div className="mt-3">
                    <IntakeProgress stage={item.stage} />
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">{stageLabel(item.stage)}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
