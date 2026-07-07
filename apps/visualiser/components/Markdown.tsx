"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CSSProperties } from "react";

/**
 * Renders note/card text as GitHub-flavoured markdown. Styling lives in
 * globals.css under `.cm-md` so it inherits each card's color and the theme
 * tokens. Links open safely in a new tab.
 */
export default function Markdown({ children, style }: { children: string; style?: CSSProperties }) {
  return (
    <div className="cm-md" style={style}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
