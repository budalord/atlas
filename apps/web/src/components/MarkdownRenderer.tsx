import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { stripH2Sections } from "../lib/markdown";
import { MermaidBlock } from "./MermaidBlock";

interface MarkdownRendererProps {
  markdown: string;
  /**
   * H2 headings (without the leading `## `) whose entire section should be
   * dropped before rendering. Used to keep STATUS.md from duplicating content
   * that the surrounding UI already renders structurally (e.g. 功能点).
   */
  skipH2Sections?: string[];
}

export function MarkdownRenderer({ markdown, skipH2Sections: skip }: MarkdownRendererProps) {
  const source = skip && skip.length > 0 ? stripH2Sections(markdown, skip) : markdown;

  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? "");
            const code = String(children).replace(/\n$/, "");

            if (match?.[1] === "mermaid") {
              return <MermaidBlock code={code} />;
            }

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
