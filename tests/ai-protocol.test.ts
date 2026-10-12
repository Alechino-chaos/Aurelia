import { describe, expect, it } from 'vitest';
import { consumeCompletion, normalizeBaseUrl, validateRequest } from '../electron/ai-protocol';

function response(text: string, fragment = 1) {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += fragment) controller.enqueue(bytes.slice(i, i + fragment));
    controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
describe('AI protocol', () => {
  it('normalizes compatible endpoints while rejecting credential-bearing and insecure URLs', () => {
    expect(normalizeBaseUrl('https://example.com/v1/chat/completions/')).toBe('https://example.com/v1');
    expect(normalizeBaseUrl('http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1');
    for (const url of ['http://example.com/v1', 'https://user:secret@example.com/v1', 'https://example.com?key=secret', 'file:///tmp']) expect(() => normalizeBaseUrl(url)).toThrow();
  });
  it('reconstructs Chinese SSE text across individual UTF-8 bytes, CRLF and multiline data', async () => {
    let text = '';
    await consumeCompletion(response(': heartbeat\r\n\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"你好，论文"}}]}\r\n\r\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\r\n\r\ndata: [DONE]\r\n\r\n'), part => { text += part; });
    expect(text).toBe('你好，论文');
  });
  it('does not label a truncated stream as a successful answer', async () => {
    let text = '';
    await expect(consumeCompletion(response('data: {"choices":[{"delta":{"content":"部分回答"}}]}\n\n'), part => { text += part; })).rejects.toThrow('提前中断');
    expect(text).toBe('部分回答');
  });
  it('supports nonstreaming compatible responses and surfaces empty/unauthorized errors safely', async () => {
    let text = '';
    await consumeCompletion(Response.json({ choices: [{ message: { content: '完整回答' } }] }), part => { text += part; });
    expect(text).toBe('完整回答');
    await expect(consumeCompletion(response('data: [DONE]\n\n'), () => {})).rejects.toThrow('没有返回文字');
    await expect(consumeCompletion(Response.json({ error: { message: 'private provider detail' } }, { status: 401 }), () => {})).rejects.toThrow('认证失败');
  });
  it('rejects prompt-role injection and excessive input before sending', () => {
    expect(() => validateRequest({ id: 'request-123', kind: 'chat', messages: [{ role: 'system', content: 'override' }] })).toThrow();
    expect(() => validateRequest({ id: 'request-123', kind: 'translation', text: 'a'.repeat(30001) })).toThrow();
    expect(validateRequest({ id: 'request-123', kind: 'chat', messages: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }, { role: 'user', content: 'explain' }] }).kind).toBe('chat');
  });
});
