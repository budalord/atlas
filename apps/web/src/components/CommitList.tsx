import { ChevronDown, ChevronRight, GitCommit as GitCommitIcon } from "lucide-react";
import { useEffect, useState } from "react";
import type { GitCommit } from "../types";

interface CommitListProps {
  productId: string;
}

interface CommitsResponse {
  data: GitCommit[];
  sourcePath: string;
  repoAvailable: boolean;
}

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function CommitList({ productId }: CommitListProps) {
  const [state, setState] = useState<CommitsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openHash, setOpenHash] = useState<string | null>(null);
  const [diffMap, setDiffMap] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/products/${productId}/commits?limit=20`)
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setState(body);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [productId]);

  async function toggleCommit(hash: string) {
    if (openHash === hash) {
      setOpenHash(null);
      return;
    }
    setOpenHash(hash);
    if (!diffMap[hash]) {
      try {
        const res = await fetch(`/api/products/${productId}/commits/${hash}`);
        if (!res.ok) {
          setDiffMap((prev) => ({ ...prev, [hash]: `(载入失败: HTTP ${res.status})` }));
          return;
        }
        const body = (await res.json()) as { data: string };
        setDiffMap((prev) => ({ ...prev, [hash]: body.data }));
      } catch (e) {
        setDiffMap((prev) => ({ ...prev, [hash]: `(载入失败: ${e instanceof Error ? e.message : String(e)})` }));
      }
    }
  }

  if (loading) {
    return (
      <Wrapper>
        <div className="px-5 py-4 text-xs text-slate-500">加载提交记录中…</div>
      </Wrapper>
    );
  }

  if (error) {
    return (
      <Wrapper>
        <div className="px-5 py-4 text-xs text-rose-600">提交记录读取失败:{error}</div>
      </Wrapper>
    );
  }

  if (!state || !state.repoAvailable) {
    return (
      <Wrapper>
        <div className="px-5 py-4 text-xs text-slate-500">
          源路径 <span className="font-mono">{state?.sourcePath || "?"}</span> 不是 git 仓库,无提交记录可读。
        </div>
      </Wrapper>
    );
  }

  if (state.data.length === 0) {
    return (
      <Wrapper>
        <div className="px-5 py-4 text-xs text-slate-500">仓库为空或没有提交。</div>
      </Wrapper>
    );
  }

  return (
    <Wrapper count={state.data.length}>
      <ul className="divide-y divide-slate-100">
        {state.data.map((c) => {
          const isOpen = openHash === c.hash;
          return (
            <li key={c.hash} className="px-2">
              <button
                type="button"
                onClick={() => toggleCommit(c.hash)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-slate-50"
                aria-expanded={isOpen}
              >
                {isOpen ? (
                  <ChevronDown size={14} className="mt-1 shrink-0 text-slate-400" />
                ) : (
                  <ChevronRight size={14} className="mt-1 shrink-0 text-slate-400" />
                )}
                <span className="mt-1 inline-block w-16 shrink-0 font-mono text-[11px] text-slate-500">
                  {c.shortHash}
                </span>
                <span className="min-w-0 flex-1 text-sm text-slate-900">{c.subject}</span>
                <span className="shrink-0 text-xs text-slate-500">
                  {c.author} · {relativeTime(c.date)}
                </span>
              </button>
              {isOpen && (
                <pre className="mb-2 ml-8 mr-2 max-h-[400px] overflow-auto rounded border border-slate-200 bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">
                  {diffMap[c.hash] ?? "加载中…"}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </Wrapper>
  );
}

function Wrapper({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-2 text-sm font-semibold text-slate-950">
        <div className="flex items-center gap-2">
          <GitCommitIcon size={14} className="text-slate-500" />
          <span>最近提交</span>
        </div>
        {typeof count === "number" && (
          <span className="text-xs font-normal text-slate-500">{count} 条</span>
        )}
      </div>
      {children}
    </div>
  );
}
