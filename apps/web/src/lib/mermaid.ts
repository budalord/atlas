import mermaid from "mermaid";

let initialized = false;

export async function renderMermaid(source: string, id: string) {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      securityLevel: "strict",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      themeVariables: {
        primaryColor: "#f1f5f9",
        primaryTextColor: "#111827",
        primaryBorderColor: "#94a3b8",
        lineColor: "#475569",
        secondaryColor: "#ecfeff",
        tertiaryColor: "#fff7ed"
      }
    });
    initialized = true;
  }

  const result = await mermaid.render(id, source);
  return result.svg;
}
