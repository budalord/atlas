import YAML from "yaml";
import type { ContractMeta, FeatureSpec, ProductMeta, TodoItem } from "@atlas/shared";

interface ParsedMarkdown<TFrontmatter> {
  frontmatter: TFrontmatter;
  body: string;
}

export function parseYaml<T>(source: string): T {
  return YAML.parse(source) as T;
}

export function parseMarkdownWithFrontmatter<TFrontmatter>(
  source: string,
  fallback: TFrontmatter
): ParsedMarkdown<TFrontmatter> {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: fallback, body: source };
  }

  return {
    frontmatter: { ...fallback, ...(YAML.parse(match[1]) as TFrontmatter) },
    body: match[2]
  };
}

export function parseStatusMarkdown(source: string) {
  const parsed = parseMarkdownWithFrontmatter<{ last_updated?: string }>(source, {});

  return {
    last_updated: parsed.frontmatter.last_updated ?? null,
    body: parsed.body,
    summary: extractSection(parsed.body, "# 当前状态"),
    todos: parseTodos(extractSection(parsed.body, "## 待办")),
    blockers: parseBullets(extractSection(parsed.body, "## 阻塞")),
    features: parseFeatureTable(extractSection(parsed.body, "## 功能点"))
  };
}

export function parseContractMarkdown(id: string, source: string) {
  const parsed = parseMarkdownWithFrontmatter<ContractMeta>(source, {
    provider: "",
    consumers: [],
    status: "draft"
  });
  const title = parsed.body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? id;

  return {
    id,
    title,
    meta: parsed.frontmatter,
    markdown: parsed.body
  };
}

export function normalizeProductMeta(meta: ProductMeta): ProductMeta {
  return {
    ...meta,
    tech_stack: Array.isArray(meta.tech_stack) ? meta.tech_stack : [],
    deploy_url: meta.deploy_url ?? null,
    tagline: meta.tagline ?? null,
    repo: meta.repo ?? null
  };
}

function extractSection(markdown: string, heading: string) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const level = heading.startsWith("##") ? "##" : "#";
  const nextHeading = level === "##" ? "\\n##\\s+" : "\\n#\\s+";
  const match = markdown.match(new RegExp(`${escaped}\\s*\\n([\\s\\S]*?)(?=${nextHeading}|$)`));
  return match?.[1]?.trim() ?? "";
}

function parseTodos(section: string): TodoItem[] {
  return section
    .split("\n")
    .map((line) => line.match(/^-\s+\[( |x|X)\]\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      done: match[1].toLowerCase() === "x",
      text: match[2].trim()
    }));
}

function parseBullets(section: string): string[] {
  return section
    .split("\n")
    .map((line) => line.replace(/^-\s+/, "").trim())
    .filter((line) => line.length > 0);
}

function parseFeatureTable(section: string): FeatureSpec[] {
  const rows = section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"));

  if (rows.length < 3) {
    return [];
  }

  return rows.slice(2).map((row) => {
    const cells = row
      .slice(1, -1)
      .split("|")
      .map((cell) => cell.trim());

    return {
      id: cells[0] ?? "",
      description: cells[1] ?? "",
      status: cells[2] ?? "",
      priority: cells[3] ?? "",
      endpoint: cells[4] ?? "",
      notes: cells[5] ?? ""
    };
  });
}
