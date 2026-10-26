"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy } from "lucide-react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import cssLang from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markdownLang from "react-syntax-highlighter/dist/esm/languages/prism/markdown";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java";

const registered: Record<string, unknown> = {
  bash,
  json,
  javascript,
  typescript,
  python,
  css: cssLang,
  markdown: markdownLang,
  sql,
  yaml,
  go,
  rust,
  java,
};
for (const [name, lang] of Object.entries(registered)) {
  SyntaxHighlighter.registerLanguage(name, lang as never);
}
// Common aliases
SyntaxHighlighter.registerLanguage("sh", bash as never);
SyntaxHighlighter.registerLanguage("shell", bash as never);
SyntaxHighlighter.registerLanguage("js", javascript as never);
SyntaxHighlighter.registerLanguage("ts", typescript as never);
SyntaxHighlighter.registerLanguage("tsx", typescript as never);
SyntaxHighlighter.registerLanguage("jsx", javascript as never);
SyntaxHighlighter.registerLanguage("py", python as never);
SyntaxHighlighter.registerLanguage("yml", yaml as never);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : "Copy code"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable */
        }
      }}
      className="absolute right-2 top-9 z-10 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-black/40 text-zinc-300 opacity-0 backdrop-blur transition hover:bg-black/60 hover:text-white group-hover/codeblock:opacity-100 focus-visible:opacity-100"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

export const Markdown = React.memo(function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className ?? "");
            const codeText = String(children).replace(/\n$/, "");
            const isBlock = codeText.includes("\n") || Boolean(match);

            if (!isBlock) {
              return (
                <code className={className} {...rest}>
                  {children}
                </code>
              );
            }

            return (
              <div className="group/codeblock relative my-3 overflow-hidden rounded-xl border border-white/10 bg-[#0d1117]">
                <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.03] px-3 py-1.5">
                  <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
                    {match?.[1] ?? "code"}
                  </span>
                  <CopyButton text={codeText} />
                </div>
                <SyntaxHighlighter
                  language={match?.[1] ?? "text"}
                  style={oneDark}
                  customStyle={{
                    margin: 0,
                    padding: "0.9rem 1rem",
                    background: "transparent",
                    fontSize: "0.84rem",
                  }}
                  wrapLongLines={false}
                  PreTag="div"
                >
                  {codeText}
                </SyntaxHighlighter>
              </div>
            );
          },
          a(props) {
            const { children, href } = props;
            return (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
