import { Env } from "../types";
import { travelRoute } from "../travel/routes";
import { digest, readBody } from "../travel/api";
import { html, css, js } from "./assets.generated";
const COOKIE = "trip_test_access",
  LIFETIME = 7 * 86400;
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};
async function signature(env: Env, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TEST_UI_ACCESS_CODE),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
async function equal(a: string, b: string) {
  return (await digest(a)) === (await digest(b));
}
async function authenticated(request: Request, env: Env) {
  if (!env.TEST_UI_ACCESS_CODE) return false;
  const token = request.headers
    .get("Cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1);
  if (!token) return false;
  const [expiry, id, sig] = token.split(".");
  if (
    !/^\d+$/.test(expiry) ||
    Number(expiry) < Date.now() / 1000 ||
    !id ||
    !sig
  )
    return false;
  return equal(sig, await signature(env, expiry + "." + id));
}
function reply(
  body: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(body, { status, headers: { ...headers, ...extra } });
}
function cookie(value: string, age = LIFETIME) {
  return `${COOKIE}=${value}; Path=/test; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`;
}
export async function testUI(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname;
  if (path !== "/test" && !path.startsWith("/test/")) return null;
  if (path === "/test") return Response.redirect(url.origin + "/test/", 302);
  if (
    request.method === "GET" &&
    ["/test/", "/test/app.js", "/test/styles.css"].includes(path)
  ) {
    const type = path.endsWith(".js")
      ? "text/javascript"
      : path.endsWith(".css")
        ? "text/css"
        : "text/html";
    return new Response(
      type === "text/javascript" ? js : type === "text/css" ? css : html,
      {
        headers: {
          ...headers,
          "Content-Type": type + "; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src https: data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        },
      },
    );
  }
  if (!path.startsWith("/test/api/"))
    return reply({ error: { message: "页面不存在" } }, 404);
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin)
    return reply({ error: { message: "请求来源不匹配" } }, 403);
  if (request.method !== "GET" && origin !== url.origin)
    return reply({ error: { message: "请从测试网页操作" } }, 403);
  try {
    if (path === "/test/api/login" && request.method === "POST") {
      if (!env.TEST_UI_ACCESS_CODE)
        return reply({ error: { message: "测试入口尚未配置" } }, 503);
      const body = await readBody(request);
      if (
        typeof body.code !== "string" ||
        !(await equal(body.code, env.TEST_UI_ACCESS_CODE))
      )
        return reply(
          { error: { message: "访问码不正确，请使用专属链接或重新输入。" } },
          401,
        );
      const value =
          Math.floor(Date.now() / 1000 + LIFETIME) + "." + crypto.randomUUID(),
        sig = await signature(env, value);
      return reply({ ok: true }, 200, {
        "Set-Cookie": cookie(value + "." + sig),
      });
    }
    if (path === "/test/api/logout" && request.method === "POST")
      return reply({ ok: true }, 200, { "Set-Cookie": cookie("", 0) });
    if (!(await authenticated(request, env)))
      return reply(
        { error: { code: "LOGIN_REQUIRED", message: "请先进入测试台" } },
        401,
      );
    if (path === "/test/api/me" && request.method === "GET")
      return reply({ ok: true });
    if (
      !/^\/test\/api\/sessions(?:\/[a-f0-9]{64}(?:\/(?:messages|results))?)?$/.test(
        path,
      )
    )
      return reply({ error: { message: "接口不存在" } }, 404);
    const forwarded = new Headers();
    forwarded.set(
      "Authorization",
      "Bearer " + (env.IOS_GATEWAY_TOKEN ?? env.APP_API_TOKEN),
    );
    for (const key of ["Content-Type", "Idempotency-Key", "X-Session-Token"]) {
      const value = request.headers.get(key);
      if (value) forwarded.set(key, value);
    }
    const target = new URL(url);
    target.pathname = path.replace("/test/api/", "/travel/v1/");
    const upstream = await travelRoute(
      new Request(target, {
        method: request.method,
        headers: forwarded,
        body: request.method === "GET" ? undefined : request.body,
      }),
      env,
    );
    // This browser gateway is same-origin only. The existing native API retains its own CORS policy.
    const out = new Headers(upstream.headers);
    for (const key of [...out.keys()])
      if (key.toLowerCase().startsWith("access-control-")) out.delete(key);
    Object.entries(headers).forEach(([k, v]) => out.set(k, v));
    return new Response(upstream.body, {
      status: upstream.status,
      headers: out,
    });
  } catch {
    return reply({ error: { message: "暂时无法连接，请稍后重试。" } }, 500);
  }
}
