export type AiSettings = {
  baseUrl: string;
  model: string;
  targetLanguage: string;
  hasApiKey: boolean;
  keyStorageAvailable: boolean;
  keyError?: string;
};
export type AiSettingsInput = Pick<AiSettings, 'baseUrl' | 'model' | 'targetLanguage'> & {
  apiKey?: string;
  clearKey?: boolean;
};
export type AiMessage = { role: 'user' | 'assistant'; content: string };
export type AiRequest = { id: string } & (
  { kind: 'translation'; text: string } |
  { kind: 'chat'; messages: AiMessage[] }
);
export type AiEvent = { id: string } & (
  { type: 'delta'; text: string } |
  { type: 'done' | 'cancelled' } |
  { type: 'error'; message: string }
);
