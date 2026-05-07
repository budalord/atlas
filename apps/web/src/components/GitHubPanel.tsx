import { ExternalLink, GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import type { GitHubSummary } from "../types";

interface GitHubPanelProps {
  productId: string;
  /** meta.repo,空则不渲染 */
  rawRepo: string | null | undefined;
}

export function GitHubPanel({ productId, rawRepo }: GitHubPanelProps) {
  const [state, setState] = useState<GitHubSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!rawRepo) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/products/${productId}/github`)
      .then((r) => r.json())
      .then((body) => {
        if (!cancelled) setState(body.data as GitHubSummary);
      })
      .catch(() => {
        if (!cancelled) setState({ repo: null, enabled: false, reason: "repo-error" });
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [productId, rawRepo]);

  if (!rawRepo) return null;

  return (
    <div className="rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-2 text-sm font-semibold text-slate-950">
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-slate-500" />
          <span>GitHub</span>
          {state?.repo && (
            <a
              className="text-xs font-normal text-slate-500 hover:text-slate-900"
              href={`https://github.com/${state.repo}`}
              rel="noopener noreferrer"
              target="_blank"
            >
              {state.repo}
            </a>
          )}
        </div>
        {state?.enabled && state.defaultBranch && (
          <span className="text-xs font-normal text-slate-500">默认分支 {state.defaultBranch}</span>
        )}
      </div>
      <div className="p-5">
        {loading ? (
          <div className="text-xs text-slate-500">加载中…</div>
        ) : !state || !state.enabled ? (
          <DisabledHint summary={state} />
        ) : (
          <Body summary={state} />
        )}
      </div>
    </div>
  );
}

function DisabledHint({ summary }: { summary: GitHubSummary | null }) {
  if (!summary) {
    return <div className="text-xs text-slate-500">未能加载 GitHub 信息。</div>;
  }
  switch (summary.reason) {
    case "unconfigured":
      return (
        <div className="text-xs text-slate-500">
          meta.yml 未填 <span className="font-mono">repo</span> 字段。填入后(支持 owner/name 或完整 URL)即可启用 GitHub 集成。
        </div>
      );
    case "gh-missing":
      return (
        <div className="text-xs text-slate-500">
          未检测到 <span className="font-mono">gh</span> CLI。请安装并 <span className="font-mono">gh auth login</span>。
        </div>
      );
    case "gh-unauthorized":
      return (
        <div className="text-xs text-slate-500">
          gh CLI 未认证或 token 已过期。请 <span className="font-mono">gh auth login</span>。
        </div>
      );
    case "repo-error":
      return (
        <div className="text-xs text-rose-600">
          仓库读取失败:可能仓库不存在、私有无访问权限,或网络受限。
          {summary.detail && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-slate-500">{summary.detail}</pre>}
        </div>
      );
    default:
      return <div className="text-xs text-slate-500">GitHub 集成未启用。</div>;
  }
}

function Body({ summary }: { summary: GitHubSummary }) {
  const prs = summary.pullRequests ?? [];
  const issues = summary.issues ?? [];
  const openPRs = prs.filter((p) => p.state === "open");
  const openIssues = issues.filter((i) => i.state === "open");

  return (
    <div className="space-y-4">
      <Section
        title="PR"
        all={prs.length}
        open={openPRs.length}
        empty="无 PR"
      >
        {openPRs.slice(0, 8).map((pr) => (
          <Row
            key={pr.number}
            href={pr.url}
            number={`#${pr.number}`}
            title={pr.title}
            meta={`${pr.author} · ${pr.headRefName} → ${pr.baseRefName}${pr.isDraft ? " · draft" : ""}`}
            tone={pr.isDraft ? "muted" : "open"}
          />
        ))}
      </Section>

      <Section
        title="Issue"
        all={issues.length}
        open={openIssues.length}
        empty="无 Issue"
      >
        {openIssues.slice(0, 8).map((it) => (
          <Row
            key={it.number}
            href={it.url}
            number={`#${it.number}`}
            title={it.title}
            meta={`${it.author}${it.labels.length ? ` · ${it.labels.join(", ")}` : ""}`}
            tone="open"
          />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  all,
  open,
  empty,
  children
}: {
  title: string;
  all: number;
  open: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2 text-xs">
        <span className="font-semibold text-slate-700">{title}</span>
        <span className="text-slate-500">
          {open} open / {all} 总
        </span>
      </div>
      {open === 0 ? (
        <div className="text-xs text-slate-400">{empty}</div>
      ) : (
        <ul className="space-y-1.5">{children}</ul>
      )}
    </div>
  );
}

function Row({
  href,
  number,
  title,
  meta,
  tone
}: {
  href: string;
  number: string;
  title: string;
  meta: string;
  tone: "open" | "muted";
}) {
  const numberCls = tone === "muted" ? "text-slate-400" : "text-emerald-700";
  return (
    <li className="flex items-start gap-2 text-sm">
      <span className={`mt-0.5 shrink-0 font-mono text-xs ${numberCls}`}>{number}</span>
      <a
        className="min-w-0 flex-1 truncate text-slate-900 hover:underline"
        href={href}
        rel="noopener noreferrer"
        target="_blank"
      >
        {title}
        <ExternalLink size={11} className="ml-1 inline text-slate-400" />
      </a>
      <span className="shrink-0 text-xs text-slate-500">{meta}</span>
    </li>
  );
}
