import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GitHubIssue, GitHubPullRequest, GitHubSummary } from "@atlas/shared";

const exec = promisify(execFile);

/**
 * 把 meta.repo 解析为 "owner/name"。支持:
 *   - "owner/name"
 *   - "github.com/owner/name"
 *   - "https://github.com/owner/name(.git)"
 *   - "git@github.com:owner/name(.git)"
 * 解析失败返回 null。
 */
export function parseRepoIdent(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const patterns: RegExp[] = [
    /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/,
    /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
    /^github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/,
    /^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

/** 用 gh api 调用,任何非 0 退出抛具结构错误。 */
async function ghApi<T>(args: string[]): Promise<T> {
  const { stdout } = await exec("gh", args, { maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

/**
 * 读取产品的 GitHub 概况:默认分支、最近 PR、最近 issue。
 * 调用方负责传入 meta.repo 原始字符串;本函数自己解析、校验 gh 是否可用、捕获各类失败。
 * 永不抛错 — 返回的 GitHubSummary.enabled / reason 反映状态。
 */
export async function readGitHubSummary(rawRepo: string | null | undefined): Promise<GitHubSummary> {
  const repo = parseRepoIdent(rawRepo);
  if (!repo) {
    return { repo: null, enabled: false, reason: "unconfigured" };
  }

  // 1. 探测 gh 是否安装并已认证
  try {
    await exec("gh", ["auth", "status"], { maxBuffer: 1024 * 1024 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/not found|ENOENT/i.test(detail)) {
      return { repo, enabled: false, reason: "gh-missing", detail: "未安装 gh CLI" };
    }
    return { repo, enabled: false, reason: "gh-unauthorized", detail };
  }

  // 2. 仓库元数据(default branch)
  let defaultBranch: string | undefined;
  try {
    const repoInfo = await ghApi<{ defaultBranchRef: { name: string } }>([
      "repo",
      "view",
      repo,
      "--json",
      "defaultBranchRef"
    ]);
    defaultBranch = repoInfo.defaultBranchRef?.name;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { repo, enabled: false, reason: "repo-error", detail };
  }

  // 3. 并行拉 PR 与 issue
  const [pullRequests, issues] = await Promise.all([
    readPullRequests(repo).catch(() => [] as GitHubPullRequest[]),
    readIssues(repo).catch(() => [] as GitHubIssue[])
  ]);

  return {
    repo,
    enabled: true,
    defaultBranch,
    pullRequests,
    issues
  };
}

interface RawPR {
  number: number;
  title: string;
  state: string;
  url: string;
  author: { login: string };
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  headRefName: string;
  baseRefName: string;
}

async function readPullRequests(repo: string): Promise<GitHubPullRequest[]> {
  const list = await ghApi<RawPR[]>([
    "pr",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    "20",
    "--json",
    "number,title,state,url,author,isDraft,createdAt,updatedAt,headRefName,baseRefName"
  ]);
  return list.map((pr) => ({
    number: pr.number,
    title: pr.title,
    state: pr.state.toLowerCase() as GitHubPullRequest["state"],
    url: pr.url,
    author: pr.author?.login ?? "?",
    isDraft: pr.isDraft,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    headRefName: pr.headRefName,
    baseRefName: pr.baseRefName
  }));
}

interface RawIssue {
  number: number;
  title: string;
  state: string;
  url: string;
  author: { login: string };
  createdAt: string;
  updatedAt: string;
  labels: { name: string }[];
}

async function readIssues(repo: string): Promise<GitHubIssue[]> {
  const list = await ghApi<RawIssue[]>([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "all",
    "--limit",
    "20",
    "--json",
    "number,title,state,url,author,createdAt,updatedAt,labels"
  ]);
  return list.map((it) => ({
    number: it.number,
    title: it.title,
    state: it.state.toLowerCase() as GitHubIssue["state"],
    url: it.url,
    author: it.author?.login ?? "?",
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
    labels: (it.labels ?? []).map((l) => l.name)
  }));
}
