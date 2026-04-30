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
 * Drop a leading H1 (with any blank lines below it) from a markdown document.
 * Used when the title is already shown by the surrounding UI.
 */
export function stripLeadingH1(markdown: string) {
  return markdown.replace(/^\s*#\s+.+\n+/, "");
}
