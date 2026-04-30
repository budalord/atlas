import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { IntakeProgress, stageLabel, stageNumber } from "../components/IntakeProgress";
import { IntakeStageCard, type StageState } from "../components/IntakeStageCard";
import { useIntakeStore } from "../stores/intakeStore";
import type { IntakePrompts, IntakeStageResponse } from "../types";

const FILES = {
  discovery: "DISCOVERY.md",
  interview: "INTERVIEW.md",
  status: "STATUS.md"
};

export function IntakeDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const fetchStage = useIntakeStore((s) => s.fetchStage);
  const fetchPrompts = useIntakeStore((s) => s.fetchPrompts);
  const complete = useIntakeStore((s) => s.complete);

  const [stageData, setStageData] = useState<IntakeStageResponse | null>(null);
  const [prompts, setPrompts] = useState<IntakePrompts | null>(null);
  const [outputs, setOutputs] = useState<{ discovery: string | null; interview: string | null; status: string | null }>({
    discovery: null,
    interview: null,
    status: null
  });
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [data, p] = await Promise.all([fetchStage(id), fetchPrompts(id)]);
      setStageData(data);
      setPrompts(p);

      const wantedFiles: Array<keyof typeof FILES> = [];
      if (data.files.discovery) wantedFiles.push("discovery");
      if (data.files.interview) wantedFiles.push("interview");
      if (data.files.status) wantedFiles.push("status");

      const fetched: Record<string, string | null> = { discovery: null, interview: null, status: null };
      await Promise.all(
        wantedFiles.map(async (key) => {
          const res = await fetch(`/api/intake/${id}/file/${FILES[key]}`).catch(() => null);
          if (res && res.ok) {
            const json = (await res.json()) as { data?: { markdown?: string } };
            fetched[key] = json.data?.markdown ?? null;
          }
        })
      );
      setOutputs({
        discovery: fetched.discovery,
        interview: fetched.interview,
        status: fetched.status
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    }
  }, [id, fetchStage, fetchPrompts]);

  useEffect(() => {
    void refresh();
    const events = new EventSource("/api/events");
    events.addEventListener("data-change", () => {
      void refresh();
    });
    return () => events.close();
  }, [refresh]);

  // Auto-complete + auto-navigate when finalized
  useEffect(() => {
    if (!stageData) return;
    if (stageData.stage === "finalized" && !completing) {
      setCompleting(true);
      void complete(id).then(() => refresh());
    }
    if (stageData.stage === "done") {
      const timer = window.setTimeout(() => navigate(`/?product=${id}`), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [stageData, completing, complete, id, refresh, navigate]);

  if (error) {
    return <main className="p-6 text-sm text-rose-700">{error}</main>;
  }
  if (!stageData || !prompts) {
    return <main className="p-6 text-sm text-slate-500">加载中...</main>;
  }

  const { info, stage, files } = stageData;
  const isDone = stage === "done";
  const isFinalized = stage === "finalized";

  const stage1State: StageState = files.discovery ? "done" : "active";
  const stage2State: StageState = !files.discovery
    ? "locked"
    : files.interview && files.interviewAnswered
    ? "done"
    : files.interview
    ? "active"
    : "active";
  const stage3State: StageState =
    !files.interview || !files.interviewAnswered
      ? "locked"
      : files.status && (isFinalized || isDone)
      ? "done"
      : "active";

  return (
    <main className="min-h-0 overflow-auto bg-slate-50">
      <div className="mx-auto max-w-4xl space-y-5 p-6">
        {isDone ? (
          <div className="flex items-center gap-3 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <CheckCircle2 size={18} />
            <div className="flex-1">
              <div className="font-semibold">录入完成!</div>
              <div className="text-xs">5 秒后自动跳转到产品详情。</div>
            </div>
            <Link
              className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
              to="/"
            >
              立即前往 <ArrowRight size={12} />
            </Link>
          </div>
        ) : null}

        <section className="rounded-md border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-slate-500">{info.theme}</div>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">{info.name}</h1>
              <div className="mt-1 text-xs text-slate-500">
                <span className="font-mono">{info.id}</span>
                <span className="mx-2">·</span>
                <span className="font-mono">{info.source_path}</span>
              </div>
            </div>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">阶段 {stageNumber(stage)}/4</span>
          </div>
          <div className="mt-4">
            <IntakeProgress stage={stage} />
          </div>
        </section>

        <IntakeStageCard
          description="让 Claude Code 探索项目代码,产出原始观察。"
          index={1}
          outputMarkdown={outputs.discovery}
          outputName="DISCOVERY.md"
          prompt={prompts.discover}
          state={stage1State}
          title="发现 (Discover)"
        />

        <IntakeStageCard
          description="基于发现,生成需要你回答的问题清单。"
          hint={
            stage2State === "active" && files.interview && !files.interviewAnswered
              ? "INTERVIEW.md 已生成,请打开文件回答问题(把 [ ] 待回答 改为你的答案)。"
              : undefined
          }
          index={2}
          outputMarkdown={outputs.interview}
          outputName="INTERVIEW.md"
          prompt={prompts.interview}
          state={stage2State}
          title="访谈 (Interview)"
        />

        <IntakeStageCard
          description="基于发现 + 访谈,生成最终的 STATUS.md。"
          index={3}
          outputMarkdown={outputs.status}
          outputName="STATUS.md"
          prompt={prompts.finalize}
          state={stage3State}
          title="沉淀 (Finalize)"
        />

        {isDone ? (
          <Link
            className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            to="/"
          >
            跳转到产品详情 <ArrowRight size={14} />
          </Link>
        ) : null}

        <div className="text-xs text-slate-400">{stageLabel(stage)}</div>
      </div>
    </main>
  );
}
