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

  // 预处理:把节点 label 里 raw 的 `<<roles: ...>>` 转 HTML 实体。
  // 历史上 Atlas 流程图节点 label 用过 `[Entity].[action].[scope] <<roles: 中文角色名>>` 格式,
  // 但 Mermaid 即使在 securityLevel:"loose" 下也会把 `<<...>>` 当成 HTML 元素并剥离内部内容
  // (渲染结果显示 `<>` — `<<roles: 销售>>` 被吃成空 tag)。 (v0.1 rev3 后流程图已删,
  // 此预处理保留以防 md 中残留旧格式 Mermaid 块)
  //
  // 此预处理仅替换 `<<` / `>>` 两个分界标记为 HTML 实体,内容保留;同时把整段塞进 `["..."]`
  // 双引号(若 label 没有引号),避免 Mermaid 解析时把中文逗号当语法。
  const preprocessed = preprocessMermaid(source);
  const result = await mermaid.render(id, preprocessed);
  return result.svg;
}

/**
 * Mermaid `[label]` 节点的 `<<...>>` 处理:
 *   1. 把 raw `<<` → `&lt;&lt;`、`>>` → `&gt;&gt;`(HTML 实体在 mermaid label 内会被原样渲染)
 *   2. 若 label 没用引号包,加上 `[" ... "]`(防止特殊字符破坏解析)
 *
 * 仅对 Mermaid flowchart 节点的方括号 label 做处理。% 注释 + 文件头不动。
 */
function preprocessMermaid(source: string): string {
  // 防御:**单独一行的 `%%`**(只有两个百分号没内容)会让 mermaid 10.x 解析器炸,
  // 报错 `Parse error on line 1: %%flowchart LR  su`(实际是 mermaid 把附近多行拼到一起
  // 给出的误导性错误位置)。Codex 生成 main.mmd 时常用 `%%` 作为注释段落分隔符,所以
  // 这里在解析前一律剥掉单独 `%%` 行,保留 `%% xxx` 这种有内容的注释。
  source = source.replace(/^[ \t]*%%[ \t]*$\n?/gm, "");

  // 匹配 `[...]` 形态的节点 label(不含已经引号包的)
  // Mermaid 也支持 `[" ... "]` — 那种直接转义内部
  // 这个正则匹配两种:
  //   - `[content with << ... >>]`  → 转义 + 加引号
  //   - `["content with << ... >>"]` → 仅转义内部
  return source.replace(/\[([^\[\]\n]*?<<[^\[\]\n]*?>>[^\[\]\n]*?)\]/g, (full, inner: string) => {
    // 若内部已被双引号包裹,只转义内部
    const trimmed = inner.trim();
    const quoted = trimmed.startsWith('"') && trimmed.endsWith('"');
    let core = quoted ? trimmed.slice(1, -1) : trimmed;
    core = core.replace(/<</g, "&lt;&lt;").replace(/>>/g, "&gt;&gt;");
    return `["${core}"]`;
  });
}
