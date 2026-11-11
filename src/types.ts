export interface Env {
  GOOGLE_MAPS_API_KEY: string;
  APP_API_TOKEN: string;
  OPENAI_API_KEY: string;
  DIDA_API_TOKEN: string;
  DIDA_API_BASE_URL?: string;
  DIDA_ACCEPT_LANGUAGE?: string;
  AGENT_MODEL?: string;
  AGENT_INSTRUCTIONS?: string;
  ALLOWED_ORIGIN?: string;
  APP_ENV?: string;
}

export interface ToolContext {
  env: Env;
}

export type JsonRecord = Record<string, unknown>;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "REQUEST_FAILED",
    public details?: unknown,
  ) {
    super(message);
  }
}
