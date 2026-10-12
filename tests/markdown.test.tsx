import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiMarkdown } from '../src/components/AiMarkdown';

const render = (text: string) => renderToStaticMarkup(<AiMarkdown text={text} />);

describe('untrusted AI Markdown', () => {
  it('renders academic explanations with emphasis, headings, lists, tables and code', () => {
    const html = render('## 核心贡献\n\n**整体定位**：一个统一模型。\n\n1. 逐步细化\n2. 按需解码\n\n| 方法 | 优势 |\n| --- | --- |\n| SpecTrA | 可伸缩 |\n\n```python\nx = 1 < 2\n```');
    expect(html).toContain('<h2>核心贡献</h2>');
    expect(html).toContain('<strong>整体定位</strong>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<table>');
    expect(html).toContain('x = 1 &lt; 2');
    expect(html).not.toContain('**整体定位**');
  });

  it('renders inline and block formulas locally while preserving code literals', () => {
    const html = render('维度 $N \\times 3$。\n\n$$\nE = \\sum_{i=1}^{N} x_i^2\n$$\n\n`$literal$`');
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('<code>$literal$</code>');
    expect(html).toContain('<math');
  });

  it('never turns model HTML, URLs or image directives into active content', () => {
    const html = render('<script>alert(1)</script>\n\n<img src="https://example.invalid/track" onerror="alert(1)">\n\n[点击](javascript:alert%281%29)\n\n[来源](https://example.invalid/paper)\n\n![远程图](https://example.invalid/track)\n\n$\\includegraphics{https://example.invalid/track}$');
    expect(html).not.toMatch(/<(script|img|iframe|a)\b/);
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onerror=');
    expect(html).toContain('https://example.invalid/paper');
    expect(html).toContain('[图片：远程图]');
  });

  it('keeps incomplete streamed Markdown and invalid formulas readable without crashing', () => {
    for (const partial of ['**未完成', '1. 项目\n\n```python\nx =', '$$\n\\frac{1}{', '$\\notACommand{x}$']) {
      expect(() => render(partial)).not.toThrow();
    }
    expect(render('$\\notACommand{x}$')).toContain('\\notACommand');
  });
});
