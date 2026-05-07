export function firstNonEmptyLine(markdown: string) {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("#"));
}

export function compactText(value: string, fallback = "未填写") {
  return value.trim().length > 0 ? value : fallback;
}

/**
 * Drop the given H2 sections from a markdown document. A section starts at
 * `## <heading>` and ends at the next H1/H2 (or end of document). Used to keep
 * the rendered STATUS.md from duplicating content already shown structurally.
 */
export function stripH2Sections(markdown: string, headings: string[]) {
  if (headings.length === 0) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+?)\s*$/);
    const h1Match = line.match(/^#\s+(.+?)\s*$/);

    if (skipping) {
      // Stop skipping when we hit any new H1 or H2.
      if (h1Match || h2Match) {
        skipping = false;
      } else {
        continue;
      }
    }

    if (h2Match && headings.includes(h2Match[1].trim())) {
      skipping = true;
      continue;
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Extract the body of a single H1 or H2 section (without the heading line).
 * Returns "" if not found. The section ends at the next H1/H2 (or EOF).
 */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let inside = false;
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (inside) {
      if (h1 || h2) break;
      result.push(line);
      continue;
    }
    if ((h1 && h1[1].trim() === heading) || (h2 && h2[1].trim() === heading)) {
      inside = true;
    }
  }
  return result.join("\n").trim();
}

/**
 * 如果一段文本的每一行都是 `**Key**: Value`(中英文冒号都接受)模式,
 * 返回结构化键值数组用于结构化渲染。任一行不匹配返回 null(交给 markdown 处理)。
 */
export function parseKeyValueLines(text: string): Array<{ label: string; value: string }> | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return null;

  const pattern = /^\*\*([^*]+?)\*\*\s*[::]\s*(.+)$/;
  const result: Array<{ label: string; value: string }> = [];
  for (const line of lines) {
    const m = line.match(pattern);
    if (!m) return null;
    result.push({ label: m[1].trim(), value: m[2].trim() });
  }
  return result.length > 0 ? result : null;
}

/**
 * Drop a leading H1 (with any blank lines below it) from a markdown document.
 * Used when the title is already shown by the surrounding UI.
 */
export function stripLeadingH1(markdown: string) {
  return markdown.replace(/^\s*#\s+.+\n+/, "");
}
