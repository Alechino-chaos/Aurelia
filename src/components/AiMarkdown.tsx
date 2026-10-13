import { memo } from 'react';
import { useLanguage } from '../i18n/LanguageProvider';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

function useMarkdownComponents(): Components {
  const { t, locale } = useLanguage();
  return {
  // Model output must never fetch remote images or open arbitrary URLs.
  img: ({ alt }) => <span className="markdown-image">{t('image', { alt: alt ? `${locale === 'en' ? ': ' : '：'}${alt}` : '' })}</span>,
  a: ({ href, children }) => <span className="markdown-reference">{children}{href && <>（<span className="markdown-url">{href}</span>）</>}</span>,
  table: ({ children }) => <div className="markdown-table" tabIndex={0} role="region" aria-label={t('回答中的表格')}><table>{children}</table></div>,
  pre: ({ children }) => <pre tabIndex={0} aria-label={t('回答中的代码')}>{children}</pre>,
};
}
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins: NonNullable<Parameters<typeof Markdown>[0]['rehypePlugins']> = [
  [rehypeKatex, { trust: false, strict: 'ignore', maxExpand: 200, maxSize: 20 }],
];

/** Renders untrusted model text as React nodes, without enabling raw HTML. */
export const AiMarkdown = memo(function AiMarkdown({ text }: { text: string }) {
  const components = useMarkdownComponents();
  return <div className="ai-markdown"><Markdown skipHtml remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>{text}</Markdown></div>;
});
