import { env, exports } from "cloudflare:workers";
import {
  runInDurableObject,
  runDurableObjectAlarm,
  evictDurableObject,
} from "cloudflare:test";
import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { SPECIALISTS } from "../src/travel/tools";
const mocks: any[] = [];
const fetchMock = {
  get: (origin: string) => ({
    intercept: (match: any) => ({
      reply: (status: number, data: any) =>
        mocks.push({ origin, ...match, status, data }),
    }),
  }),
  activate: () =>
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      const i = mocks.findIndex(
        (m) =>
          m.origin + m.path === url &&
          m.method === (init?.method ?? "GET") &&
          (!m.body || m.body(init.body)),
      );
      if (i < 0) throw Error("Unexpected HTTP request: " + url);
      const m = mocks.splice(i, 1)[0];
      return Response.json(m.data, { status: m.status });
    }),
  disableNetConnect: () => {},
  assertNoPendingInterceptors: () => expect(mocks).toEqual([]),
};
const upstream = "https://api.openai.com";
const get = (path: string, data: any) =>
  fetchMock
    .get(upstream)
    .intercept({ path: "/v1" + path, method: "GET" })
    .reply(200, data);
const post = (path: string, data: any) =>
  fetchMock
    .get(upstream)
    .intercept({ path: "/v1" + path, method: "POST" })
    .reply(200, data);
beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});
afterEach(() => fetchMock.assertNoPendingInterceptors());
async function create(input = "test") {
  const key = crypto.randomUUID();
  const r = await exports.default.fetch("https://test/travel/v1/sessions", {
    method: "POST",
    headers: { Authorization: "Bearer test-gateway", "Idempotency-Key": key },
    body: JSON.stringify({ input, timezone: "Asia/Shanghai" }),
  });
  const b: any = await r.json();
  const stub = env.TRAVEL_SESSIONS.get(env.TRAVEL_SESSIONS.idFromName(b.id));
  return { b, stub, key };
}
const status = async (stub: any, token: string) =>
  (
    await stub.fetch("https://test/status", {
      headers: { "X-Session-Token": token },
    })
  ).json();
describe("durable coordinator", () => {
  it("requires both gateway authentication and the session token", async () => {
    expect(
      (
        await exports.default.fetch("https://test/travel/v1/sessions", {
          method: "POST",
        })
      ).status,
    ).toBe(401);
    const { b, stub } = await create();
    expect((await stub.fetch("https://test/status")).status).toBe(403);
    expect((await status(stub, b.session_token)).status).toBe("starting");
    await runInDurableObject(stub, async (_, s) => s.storage.deleteAlarm());
  });
  it("persists a scheduled session across eviction and waits for a real final turn", async () => {
    const { b, stub } = await create();
    await evictDurableObject(stub);
    expect((await status(stub, b.session_token)).status).toBe("starting");
    post("/agents/sessions", { id: "parent-one" });
    await runDurableObjectAlarm(stub);
    get("/agents/sessions/parent-one", {
      status: "idle",
      required_actions: [],
    });
    get("/agents/sessions/parent-one/items?limit=100&order=desc", { data: [] });
    await runDurableObjectAlarm(stub);
    expect((await status(stub, b.session_token)).status).toBe("running");
    get("/agents/sessions/parent-one", {
      status: "idle",
      required_actions: [],
    });
    get("/agents/sessions/parent-one/items?limit=100&order=desc", {
      data: [
        {
          id: "m",
          type: "message",
          role: "assistant",
          phase: "final_answer",
          status: "completed",
          turn_id: "t1",
          content: [{ type: "output_text", text: "done" }],
        },
      ],
    });
    get("/agents/sessions/parent-one/turns/t1", { status: "completed" });
    await runDurableObjectAlarm(stub);
    expect((await status(stub, b.session_token)).status).toBe("completed");
    await runInDurableObject(stub, async (_, s) => s.storage.deleteAlarm());
  });
  it("dispatches all seven names to their saved IDs and returns one result per call", async () => {
    const { b, stub } = await create();
    post("/agents/sessions", { id: "parent-seven" });
    await runDurableObjectAlarm(stub);
    const actions = Object.keys(SPECIALISTS).map((name, i) => ({
      type: "function_call",
      name,
      call_id: "call-" + i,
      turn_id: "turn-main",
      arguments: { request: { today: "2026-11-12", tripId: "TRIP-1" } },
    }));
    get("/agents/sessions/parent-seven", { required_actions: actions });
    get("/agents/sessions/parent-seven/items?limit=100&order=desc", {
      data: [],
    });
    for (const [i, [name, id]] of Object.entries(SPECIALISTS).entries()) {
      get("/agents/" + id, { tools: [] });
      fetchMock
        .get(upstream)
        .intercept({
          path: "/v1/agents/sessions",
          method: "POST",
          body: (body: string) => JSON.parse(body).agent_id === id,
        })
        .reply(200, { id: "child-" + i });
    }
    await runDurableObjectAlarm(stub);
    expect((await status(stub, b.session_token)).dispatches).toHaveLength(7);
    get("/agents/sessions/parent-seven", { required_actions: actions });
    get("/agents/sessions/parent-seven/items?limit=100&order=desc", {
      data: [],
    });
    for (let i = 0; i < 7; i++) {
      get("/agents/sessions/child-" + i, { required_actions: [] });
      get(`/agents/sessions/child-${i}/items?limit=100&order=desc`, {
        data: [
          {
            type: "message",
            role: "assistant",
            phase: "final_answer",
            status: "completed",
            turn_id: "ct" + i,
            content: [
              { type: "output_text", text: '{"status":"need_more_info"}' },
            ],
          },
        ],
      });
      get(`/agents/sessions/child-${i}/turns/ct${i}`, { status: "completed" });
    }
    await runDurableObjectAlarm(stub);
    await evictDurableObject(stub);
    get("/agents/sessions/parent-seven", { required_actions: actions });
    get("/agents/sessions/parent-seven/items?limit=100&order=desc", {
      data: [],
    });
    for (let i = 0; i < 7; i++)
      post("/agents/sessions/parent-seven/events", {});
    await runDurableObjectAlarm(stub);
    expect(
      (await status(stub, b.session_token)).dispatches.every(
        (j: any) => j.status === "completed",
      ),
    ).toBe(true);
    await runInDurableObject(stub, async (_, s) => s.storage.deleteAlarm());
  });
  it("requires an applied receipt, serializes client requests, and preserves retry identity", async () => {
    const { b, stub } = await create();
    post("/agents/sessions", { id: "parent-write" });
    await runDurableObjectAlarm(stub);
    const action = {
      type: "function_call",
      name: "apply_local_trip_changes",
      call_id: "save-call",
      turn_id: "save-turn",
      arguments: {
        operationId: "save-trip-001",
        tripId: null,
        expectedVersion: 0,
        changes: [
          {
            table: "trips",
            action: "insert",
            ref: "TRIP-1",
            data: {
              tripName: "旅行",
              startDate: "2026-11-20",
              endDate: "2026-11-21",
              status: "规划中",
            },
          },
        ],
      },
    };
    get("/agents/sessions/parent-write", { required_actions: [action] });
    get("/agents/sessions/parent-write/items?limit=100&order=desc", {
      data: [],
    });
    await runDurableObjectAlarm(stub);
    const result = {
      call_id: "save-call",
      success: true,
      output: {
        status: "applied",
        operationId: "save-trip-001",
        tripId: "local-trip",
        version: 1,
        idMap: { "TRIP-1": "local-trip" },
      },
    };
    const submit = (body: any, key = "receipt-request-001") =>
      stub.fetch("https://test/results", {
        method: "POST",
        headers: { "X-Session-Token": b.session_token, "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
    expect(
      (await submit({ ...result, output: { status: "saved" } })).status,
    ).toBe(400);
    expect((await submit({ ...result, call_id: "server-call" })).status).toBe(
      409,
    );
    expect((await submit(result)).status).toBe(202);
    expect((await submit(result)).status).toBe(202);
    expect((await submit(result, "another-request-001")).status).toBe(409);
    post("/agents/sessions/parent-write/events", {});
    get("/agents/sessions/parent-write", { required_actions: [] });
    get("/agents/sessions/parent-write/items?limit=100&order=desc", {
      data: [
        {
          type: "message",
          role: "assistant",
          phase: "final_answer",
          status: "completed",
          turn_id: "save-turn",
          content: [{ type: "output_text", text: "saved" }],
        },
      ],
    });
    get("/agents/sessions/parent-write/turns/save-turn", {
      status: "completed",
    });
    await runDurableObjectAlarm(stub);
    expect((await submit(result)).status).toBe(202);
    expect((await submit({ ...result, success: false })).status).toBe(409);
    await runInDurableObject(stub, async (_, state) =>
      state.storage.deleteAlarm(),
    );
  });
});
