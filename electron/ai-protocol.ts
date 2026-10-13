import { appError, appMessage, AppUiError, httpStatusMessage } from './i18n.js';
import type { AiMessage, AiRequest } from './ai-types.js';

export function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2000) throw appError('请填写有效的 API 地址。');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw appError('API 地址需要包含 https:// 或本机 http://。'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw appError('远程 API 请使用 HTTPS；本机服务可使用 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw appError('API 地址不能包含用户名、密码、查询参数或片段。');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return url.href.replace(/\/+$/, '');
}

export function validateRequest(value: unknown): AiRequest {
  if (!value || typeof value !== 'object') throw appError('无效的 AI 请求。');
  const request = value as AiRequest;
  if (typeof request.id !== 'string' || !/^[\w-]{8,80}$/.test(request.id)) throw appError('无效的请求编号。');
  if (request.kind === 'translation') {
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 30_000) throw appError('请选择 1–30,000 个字符进行翻译。');
    return { id: request.id, kind: request.kind, text: request.text };
  }
  if (request.kind !== 'chat' || !Array.isArray(request.messages) || !request.messages.length || request.messages.length > 41) throw appError('对话过长，请新建对话。');
  let length = 0;
  const messages = request.messages.map((message, index): AiMessage => {
    if (!message || message.role !== (index % 2 === 0 ? 'user' : 'assistant') || typeof message.content !== 'string' || !message.content.trim()) throw appError('无效的对话内容。');
    length += message.content.length;
    return { role: message.role, content: message.content };
  });
  if (messages.at(-1)?.role !== 'user' || length > 100_000) throw appError('对话内容过长，请新建对话或缩短选区。');
  return { id: request.id, kind: request.kind, messages };
}

export function httpError(status: number): string {
  if (status === 401 || status === 403) return appMessage('认证失败，请检查 API Key、模型权限和账户状态。');
  if (status === 429) return appMessage('请求过于频繁或额度不足，请稍后重试并检查账户余额。');
  if (status === 404) return appMessage('未找到接口或模型，请检查 API 地址和模型名称。');
  if (status === 400 || status === 422) return appMessage('服务商拒绝了请求，请检查模型是否支持 Chat Completions，或缩短对话。');
  return httpStatusMessage(status);
}

// Handle SSE event boundaries independently of UTF-8/network chunk boundaries.
export async function consumeCompletion(response: Response, onDelta: (text: string) => void): Promise<void> {
  if (!response.ok) throw new AppUiError(httpError(response.status));
  let outputLength = 0;
  const emit = (text: unknown) => {
    if (typeof text !== 'string' || !text) return;
    outputLength += text.length;
    if (outputLength > 120_000) throw appError('回答过长，已停止接收。请缩小问题范围。');
    onDelta(text);
  };
  const content = (message: any) => {
    if (message?.refusal) throw appError('模型未能回答此请求，请调整问题后重试。');
    if (Array.isArray(message?.content)) {
      for (const part of message.content) if (part?.type === 'text') emit(part.text);
    } else emit(message?.content);
  };
  if (response.headers.get('content-type')?.includes('application/json')) {
    // Some compatible services ignore stream:true and return a single JSON body.
    const reader = response.body?.getReader();
    if (!reader) throw appError('服务返回了空响应。');
    const decoder = new TextDecoder(); let text = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        if (text.length > 1_000_000) throw appError('服务响应过大。');
      }
      text += decoder.decode();
      let data: any;
      try { data = JSON.parse(text); } catch { throw appError('服务返回的 JSON 无法解析。'); }
      if (data.error) throw appError('AI 服务返回错误，请检查模型及账户配置。');
      content(data.choices?.[0]?.message);
      if (data.choices?.[0]?.finish_reason === 'length') emit('\n\n[回答达到模型长度限制，可继续追问。]');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  } else {
    const reader = response.body?.getReader();
    if (!reader) throw appError('服务返回了空响应。');
    const decoder = new TextDecoder();
    let buffer = ''; let finished = false; let sawFinish = false;
    const event = (block: string) => {
      const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n').trim();
      if (!data) return;
      if (data === '[DONE]') { finished = true; return; }
      let payload: any;
      try { payload = JSON.parse(data); } catch { throw appError('流式响应格式不正确，请检查服务是否兼容 Chat Completions。'); }
      if (payload.error) throw appError('AI 服务中断了回答，请稍后重试。');
      const choice = payload.choices?.[0];
      content(choice?.delta);
      if (choice?.finish_reason) sawFinish = true;
      if (choice?.finish_reason === 'length') emit('\n\n[回答达到模型长度限制，可继续追问。]');
      if (choice?.finish_reason === 'content_filter') throw appError('服务商未返回完整回答，请调整问题后重试。');
    };
    try {
      while (!finished) {
        const { done, value } = await reader.read();
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        if (buffer.length > 1_000_000) throw appError('服务响应过大或格式不正确。');
        let boundary: RegExpExecArray | null;
        while (!finished && (boundary = /\r?\n\r?\n/.exec(buffer))) {
          event(buffer.slice(0, boundary.index));
          buffer = buffer.slice(boundary.index + boundary[0].length);
        }
        if (done) { if (buffer.trim() && !finished) event(buffer); break; }
      }
      if (!finished && !sawFinish) throw appError('连接提前中断，回答可能不完整，请重试。');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }
  if (!outputLength) throw appError('模型没有返回文字，请检查模型名称或重试。');
}
