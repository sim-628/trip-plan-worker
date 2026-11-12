import { Env, HttpError } from "../types";
export async function api(
  env: Env,
  path: string,
  body?: unknown,
  key?: string,
): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch("https://api.openai.com/v1" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization:
          "Bearer " + (env.TRAVEL_OPENAI_API_KEY ?? env.OPENAI_API_KEY),
        "OpenAI-Beta": "agents=v1",
        "User-Agent": "TripPlan/1 CFNetwork",
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpError(
        response.status >= 500 ? 502 : response.status,
        "Agent service request failed",
        "AGENT_UPSTREAM_" + response.status,
      );
    }
    const raw = await response.text();
    return raw ? JSON.parse(raw) : {};
  } finally {
    clearTimeout(timeout);
  }
}
export async function vaultsFor(env: Env, tools: any[]): Promise<string[]> {
  const needed = new Set(tools.map((t) => t.credential_id).filter(Boolean));
  if (!needed.size) return [];
  const vaults = (await api(env, "/vaults?limit=100")).data ?? [];
  const matched = await Promise.all(
    vaults.map(async (v: any) => {
      const rows =
        (await api(env, `/vaults/${v.id}/credentials?limit=100`)).data ?? [];
      return rows.some((c: any) => needed.has(c.id)) ? v.id : null;
    }),
  );
  const ids = matched.filter(Boolean);
  if (!ids.length)
    throw new HttpError(
      503,
      "No vault found for specialist tools",
      "MISSING_VAULT",
    );
  return ids;
}
export async function digest(text: string) {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function textOf(item: any): string {
  return (item?.content ?? [])
    .filter((p: any) => ["text", "output_text"].includes(p.type))
    .map((p: any) =>
      typeof p.text === "string" ? p.text : (p.text?.value ?? ""),
    )
    .join("\n");
}
export function finalOf(items: any[]) {
  return items.find(
    (i) =>
      i.type === "message" &&
      i.role === "assistant" &&
      i.status === "completed" &&
      i.phase === "final_answer",
  );
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return {};
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 131072) {
      await reader.cancel();
      throw new HttpError(413, "Request exceeds 128 KiB", "BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(all));
  } catch {
    throw new HttpError(400, "Invalid JSON", "INVALID_JSON");
  }
}

/** A response can be lost after OpenAI has accepted a result. Reconcile instead of
 * reporting that successful query as failed or submitting a second effect. */
export async function deliverEvent(
  env: Env,
  sessionId: string,
  event: any,
  key: string,
) {
  try {
    return await api(
      env,
      `/agents/sessions/${sessionId}/events`,
      { events: [event] },
      key,
    );
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.status === 409 &&
      event.type === "agent.session.input.tool_result"
    ) {
      const current = await api(env, `/agents/sessions/${sessionId}`);
      if (
        !(current.required_actions ?? []).some(
          (a: any) =>
            a.call_id === event.call_id && a.turn_id === event.turn_id,
        )
      )
        return { already_accepted: true };
    }
    throw error;
  }
}
