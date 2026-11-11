import { Env, HttpError } from "../types";
import { OPENAI_TOOLS } from "../tools/definitions";

const BASE = "https://api.openai.com/v1";
const BETA = "agents=v1";

async function request<T>(env: Env, path: string, init: RequestInit = {}): Promise<T> {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, "OPENAI_API_KEY is not configured", "OPENAI_NOT_CONFIGURED");
  const response = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: "Bearer " + env.OPENAI_API_KEY,
      "OpenAI-Beta": BETA,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body: any = await response.json().catch(() => null);
    throw new HttpError(response.status >= 500 ? 502 : response.status,
      body?.error?.message || "OpenAI Agents API request failed",
      body?.error?.code || "OPENAI_API_ERROR");
  }
  return response.json() as Promise<T>;
}

export async function createSession(env: Env, input: string, model: string, instructions: string) {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, "OPENAI_API_KEY is not configured", "OPENAI_NOT_CONFIGURED");
  const response = await fetch(BASE + "/agents/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.OPENAI_API_KEY,
      "OpenAI-Beta": BETA,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      environment: { type: "none" },
      agent: {
        name: "Travel Planner",
        model,
        instructions,
        tools: OPENAI_TOOLS,
      },
      input,
      stream: true,
    }),
  });
  if (!response.ok || !response.body) {
    throw new HttpError(response.status || 502,
      await response.text().catch(() => "Could not create managed Agent session"),
      "OPENAI_SESSION_CREATE_FAILED");
  }
  return response;
}

export async function retrieveSession(env: Env, sessionId: string) {
  return request<any>(env, "/agents/sessions/" + encodeURIComponent(sessionId));
}

export async function submitEvents(env: Env, sessionId: string, events: unknown[], idempotencyKey?: string) {
  return request<any>(env, "/agents/sessions/" + encodeURIComponent(sessionId) + "/events", {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    body: JSON.stringify({ events }),
  });
}

export async function openEventStream(env: Env, sessionId: string) {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, "OPENAI_API_KEY is not configured", "OPENAI_NOT_CONFIGURED");
  const response = await fetch(BASE + "/agents/sessions/" + encodeURIComponent(sessionId) + "/events", {
    headers: {
      Authorization: "Bearer " + env.OPENAI_API_KEY,
      "OpenAI-Beta": BETA,
      Accept: "text/event-stream",
    },
  });
  if (!response.ok || !response.body) {
    throw new HttpError(response.status || 502, await response.text().catch(() => "Unable to open Agents API event stream"), "OPENAI_STREAM_ERROR");
  }
  return response.body;
}
