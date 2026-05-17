import mermaid from "mermaid";

let initialized = false;

export async function renderMermaid(source: string, id: string) {
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      // securityLevel: "loose" 是为了让节点 label 中的 `<<roles: ...>>` 不被
      // sanitizer 剥离。我们的 mermaid 源仅来自 Agent 派生(派生文件 + git diff
      // 受控),不接收用户输入,所以 loose 不引入 XSS 风险。
      securityLevel: "loose",
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
