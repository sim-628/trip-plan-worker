export interface Env {
  GOOGLE_MAPS_API_KEY: string;
  APP_API_TOKEN: string;
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
