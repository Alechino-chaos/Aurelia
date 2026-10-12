import { memo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const components: Components = {
  // Model output must never fetch remote images or open arbitrary URLs.
  img: ({ alt }) => <span className="markdown-image">[图片{alt ? `：${alt}` : ''}]</span>,
  a: ({ href, children }) => <span className="markdown-reference">{children}{href && <>（<span className="markdown-url">{href}</span>）</>}</span>,
  table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label="回答中的表格"><table>{children}</table></div>,
  pre: ({ children }) => <pre tabIndex={0} aria-label="回答中的代码">{children}</pre>,
};
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: NonNullable<Parameters<typeof Markdown>[0]['rehypePlugins']> = [
  [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20 }],
];

/** Renders untrusted model text as React nodes, without enabling raw HTML. */
export const AiMarkdown = memo(function AiMarkdown({ text }: { text: string }) {
  return <div className="ai-markdown"><Markdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{text}</Markdown></div>;
});
