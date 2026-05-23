/**
 * ModelPort — Hexagonal port for LLM invocation
 *
 * Adapters: kimi-api, openai-api, ollama, deepseek
 */

export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ModelRequest {
  readonly messages: ModelMessage[];
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly tools?: unknown[];
}

export interface ModelResponse {
  readonly content: string;
  readonly usage?: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
  };
}

export interface ModelPort {
  readonly name: string;

  /** Send a completion request */
  complete(request: ModelRequest): Promise<ModelResponse>;

  /** Health check */
  health(): Promise<{ ok: boolean; message?: string }>;
}
