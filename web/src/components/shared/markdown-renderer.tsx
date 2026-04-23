"use client";

import { memo, useMemo, useState, useCallback, type ClipboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import dynamic from "next/dynamic";
import { Copy, Check } from "lucide-react";

function CodeBlockCopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);
  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-background/80 border border-border/50 text-muted-foreground hover:text-foreground opacity-0 group-hover/code:opacity-100 transition-opacity"
      title="Copy code"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

const MermaidBlock = dynamic(
  () => import("./mermaid-block").then((m) => m.MermaidBlock),
  { ssr: false }
);

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    return extractText(el.props.children);
  }
  return "";
}

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = "",
}: MarkdownRendererProps) {
  const sanitized = useMemo(() => {
    let s = content;
    // Strip complete <function_calls>...</function_calls> blocks (with or without antml: prefix)
    s = s.replace(/<(antml:)?function_calls>[\s\S]*?<\/(antml:)?function_calls>/g, '');
    // Strip trailing incomplete block (streaming — opening tag with no close yet)
    s = s.replace(/<(antml:)?function_calls>[\s\S]*$/g, '');
    return s.trim();
  }, [content]);

  const plugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(() => [rehypeHighlight], []);

  const components = useMemo(
    () => ({
      pre({ children, ...props }: React.ComponentProps<"pre">) {
        const codeText = extractText(children);
        return (
          <div className="relative group/code">
            <pre {...props}>{children}</pre>
            {codeText && <CodeBlockCopyButton code={codeText} />}
          </div>
        );
      },
      code({ className: codeClassName, children, ...props }: React.ComponentProps<"code"> & { inline?: boolean }) {
        const match = /language-(\w+)/.exec(codeClassName || "");
        const lang = match?.[1];

        // Render mermaid code blocks as diagrams
        if (lang === "mermaid") {
          const chart = String(children).replace(/\n$/, "");
          return <MermaidBlock chart={chart} />;
        }

        // For inline code or code without a language, render normally
        return (
          <code className={codeClassName} {...props}>
            {children}
          </code>
        );
      },
    }),
    []
  );

  const handleCopy = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
    const text = window.getSelection()?.toString();
    if (text) {
      e.preventDefault();
      navigator.clipboard.writeText(text);
    }
  }, []);

  return (
    <div className={`markdown-content ${className}`} onCopy={handleCopy}>
      <ReactMarkdown
        remarkPlugins={plugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {sanitized}
      </ReactMarkdown>
    </div>
  );
});
