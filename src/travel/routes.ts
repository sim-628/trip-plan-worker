import { Env, HttpError } from "../types";
import { digest, json, readBody } from "./api";
export async function travelRoute(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url),
    origin = env.ALLOWED_ORIGIN ?? "*";
  let response: Response;
  try {
    if (request.method === "OPTIONS")
      response = new Response(null, { status: 204 });
    else {
      const auth = request.headers.get("Authorization");
      if (
        ![env.APP_API_TOKEN, env.IOS_GATEWAY_TOKEN].some(
          (t) => t && auth === "Bearer " + t,
        )
      )
        throw new HttpError(401, "Unauthorized", "UNAUTHORIZED");
      if (url.pathname === "/travel/v1/sessions" && request.method === "POST") {
        const key = request.headers.get("Idempotency-Key");
        if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key))
          throw new HttpError(
            400,
            "Idempotency-Key required (16–100 characters)",
            "INVALID_IDEMPOTENCY_KEY",
          );
        const b = await readBody(request);
        if (
          typeof b.input !== "string" ||
          !b.input.trim() ||
          b.input.length > 20000
        )
          throw new HttpError(
            400,
            "input required (max 20,000 characters)",
            "INVALID_INPUT",
          );
        const timezone = b.timezone ?? "Asia/Shanghai";
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
        } catch {
          throw new HttpError(400, "Invalid timezone", "INVALID_TIMEZONE");
        }
        const capabilities = b.capabilities ?? [];
        if (
          !Array.isArray(capabilities) ||
          capabilities.some((c) => !["cards", "local_trip_storage"].includes(c))
        )
          throw new HttpError(400, "Unknown capability", "INVALID_CAPABILITY");
        const id = await digest(auth + "\n" + key),
          stub = env.TRAVEL_SESSIONS.get(env.TRAVEL_SESSIONS.idFromName(id));
        const upstream = await stub.fetch("https://coordinator/init", {
          method: "POST",
          body: JSON.stringify({ input: b.input, timezone, capabilities }),
        });
        response = json(
          { id, ...((await upstream.json()) as object) },
          upstream.status,
        );
      } else {
        const m = url.pathname.match(
          /^\/travel\/v1\/sessions\/([a-f0-9]{64})(?:\/(messages|results))?$/,
        );
        if (!m || (m[2] ? request.method !== "POST" : request.method !== "GET"))
          throw new HttpError(404, "Route not found", "NOT_FOUND");
        const stub = env.TRAVEL_SESSIONS.get(
          env.TRAVEL_SESSIONS.idFromName(m[1]),
        );
        response = await stub.fetch(
          new Request("https://coordinator/" + (m[2] ?? "status"), request),
        );
      }
    }
  } catch (e) {
    response =
      e instanceof HttpError
        ? json({ error: { code: e.code, message: e.message } }, e.status)
        : json(
            {
              error: {
                code: "INTERNAL_ERROR",
                message: "Travel service unavailable",
              },
            },
            500,
          );
  }
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization,Content-Type,Idempotency-Key,X-Session-Token",
  );
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}
