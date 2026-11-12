import { DurableObject } from "cloudflare:workers";
import { Env, HttpError } from "../types";
import {
  api,
  digest,
  finalOf,
  textOf,
  json,
  readBody,
  vaultsFor,
  deliverEvent,
} from "./api";
import {
  MAIN_AGENT_ID,
  SPECIALISTS,
  toolsFor,
  CLIENT_TOOL_NAMES,
  READ_ONLY_SUPPLY,
} from "./tools";
import { validateBatch } from "./local-store";
interface Job {
  call: any;
  child?: string;
  result?: any;
  done?: boolean;
  started: number;
  attempts: number;
  error?: string;
}
interface State {
  token: string;
  fingerprint: string;
  input: string;
  timezone: string;
  capabilities: string[];
  parent?: string;
  created: number;
  activeUntil: number;
  expires: number;
  status: string;
  error?: string;
  jobs: Record<string, Job>;
  actions: any[];
  messages: any[];
  lastTurn?: string;
  awaitingTurn?: boolean;
  receipts: Record<string, { fingerprint: string; result: any }>;
}
const RETENTION = 7 * 86400000,
  TURN_LIMIT = 15 * 60000;
export class TravelSessionCoordinator extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  private async save(s: State) {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS coordinator_state (id INTEGER PRIMARY KEY, json TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO coordinator_state VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json",
      JSON.stringify(s),
    );
  }
  private async load(): Promise<State | undefined> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS coordinator_state (id INTEGER PRIMARY KEY, json TEXT NOT NULL)",
    );
    const row = this.ctx.storage.sql
      .exec<{ json: string }>("SELECT json FROM coordinator_state WHERE id=1")
      .toArray()[0];
    return row ? JSON.parse(row.json) : undefined;
  }
  private async schedule(s: State, delay = 3000) {
    await this.ctx.storage.setAlarm(
      ["running", "starting"].includes(s.status)
        ? Date.now() + delay
        : s.expires,
    );
  }
  async fetch(request: Request): Promise<Response> {
    return this.exclusive(async () => {
      try {
        const path = new URL(request.url).pathname;
        let s = await this.load();
        if (path === "/init") {
          const b = await readBody(request),
            fingerprint = await digest(JSON.stringify(b));
          if (s && s.fingerprint !== fingerprint)
            throw new HttpError(
              409,
              "Idempotency key reused with different input",
              "IDEMPOTENCY_CONFLICT",
            );
          if (!s) {
            s = {
              token: crypto.randomUUID() + crypto.randomUUID(),
              fingerprint,
              input: b.input,
              timezone: b.timezone,
              capabilities: b.capabilities,
              created: Date.now(),
              activeUntil: Date.now() + TURN_LIMIT,
              expires: Date.now() + RETENTION,
              status: "starting",
              jobs: {},
              actions: [],
              messages: [],
              receipts: {},
            };
            await this.save(s);
            await this.schedule(s, 1);
          }
          return json({ session_token: s.token, status: s.status }, 202);
        }
        if (!s || Date.now() > s.expires)
          throw new HttpError(
            404,
            "Session expired or not found",
            "SESSION_NOT_FOUND",
          );
        if (request.headers.get("X-Session-Token") !== s.token)
          throw new HttpError(403, "Invalid session token", "FORBIDDEN");
        if (path === "/status")
          return json({
            status: s.status,
            error: s.error,
            messages: s.messages,
            required_actions: s.actions,
            dispatches: Object.values(s.jobs).map((j) => ({
              name: j.call.name,
              call_id: j.call.call_id,
              status: j.done
                ? "completed"
                : j.result
                  ? "returning_result"
                  : j.child
                    ? "running"
                    : "queued",
              error: j.error,
            })),
            expires_at: new Date(s.expires).toISOString(),
          });
        const b = await readBody(request),
          key = request.headers.get("Idempotency-Key");
        if (!key || !/^[A-Za-z0-9_-]{16,100}$/.test(key))
          throw new HttpError(
            400,
            "Idempotency-Key must be 16–100 letters, digits, hyphens or underscores",
            "INVALID_IDEMPOTENCY_KEY",
          );
        const fingerprint = await digest(path + JSON.stringify(b)),
          old = s.receipts[key];
        const queued = await this.ctx.storage.get<any>("pending");
        if (queued) {
          if (queued.key === key && queued.fingerprint === fingerprint)
            return json({ accepted: true }, 202);
          throw new HttpError(
            409,
            "Previous request is still being accepted",
            "REQUEST_PENDING",
          );
        }
        if (old) {
          if (old.fingerprint !== fingerprint)
            throw new HttpError(
              409,
              "Idempotency key conflict",
              "IDEMPOTENCY_CONFLICT",
            );
          return json(old.result, 202);
        }
        if (!s.parent)
          throw new HttpError(409, "Session is starting", "SESSION_STARTING");
        if (path === "/messages") {
          if (s.status !== "completed")
            throw new HttpError(
              409,
              "Wait for the current turn and client actions to finish",
              "TURN_BUSY",
            );
          if (
            typeof b.input !== "string" ||
            !b.input.trim() ||
            b.input.length > 20000
          )
            throw new HttpError(
              400,
              "input is required (max 20,000 characters)",
              "INVALID_INPUT",
            );
          // Persist the pending operation before networking so a process restart can replay safely.
          await this.ctx.storage.put("pending", {
            key,
            fingerprint,
            path,
            input: b.input,
          });
        } else if (path === "/results") {
          const action = s.actions.find((a) => a.call_id === b.call_id);
          if (!action || !CLIENT_TOOL_NAMES.has(action.name))
            throw new HttpError(
              409,
              "No matching client-owned action",
              "INVALID_TOOL_RESULT",
            );
          if (typeof b.success !== "boolean")
            throw new HttpError(
              400,
              "success must be boolean",
              "INVALID_TOOL_RESULT",
            );
          if (b.success && action.name === "apply_local_trip_changes") {
            const batch = validateBatch(action.arguments),
              r = b.output;
            if (
              !r ||
              r.status !== "applied" ||
              r.operationId !== batch.operationId ||
              r.version !== batch.expectedVersion + 1 ||
              typeof r.tripId !== "string" ||
              (batch.tripId !== null && r.tripId !== batch.tripId) ||
              batch.changes.some(
                (c) =>
                  c.action === "insert" && typeof r.idMap?.[c.ref] !== "string",
              )
            )
              throw new HttpError(
                400,
                "A matching committed local-write receipt is required",
                "INVALID_LOCAL_RECEIPT",
              );
          }
          if (
            b.success &&
            action.name === "read_local_trip" &&
            (!b.output ||
              !Number.isInteger(b.output.version) ||
              !b.output.tables)
          )
            throw new HttpError(
              400,
              "Expected local version and tables",
              "INVALID_LOCAL_SNAPSHOT",
            );
          await this.ctx.storage.put("pending", {
            key,
            fingerprint,
            path,
            action,
            result: b,
          });
        } else throw new HttpError(404, "Unknown endpoint", "NOT_FOUND");
        s.status = "running";
        s.activeUntil = Date.now() + TURN_LIMIT;
        await this.save(s);
        await this.schedule(s, 1);
        return json({ accepted: true }, 202);
      } catch (e) {
        return this.failure(e);
      }
    });
  }
  private failure(e: unknown) {
    return e instanceof HttpError
      ? json({ error: { code: e.code, message: e.message } }, e.status)
      : json(
          {
            error: {
              code: "INVALID_REQUEST",
              message: "Invalid request or table data",
            },
          },
          400,
        );
  }
  async alarm() {
    return this.exclusive(async () => {
      let s = await this.load();
      if (!s) return;
      if (Date.now() > s.expires) {
        await this.ctx.storage.deleteAll();
        return;
      }
      if (!["running", "starting"].includes(s.status)) {
        await this.schedule(s);
        return;
      }
      // Schedule the next tick first, so a crash during a network request cannot strand the run.
      await this.schedule(s, 5000);
      try {
        if (Date.now() > s.activeUntil) {
          s.status = "failed";
          s.error = "TURN_TIMEOUT";
          await this.save(s);
          await this.schedule(s);
          return;
        }
        if (!s.parent) {
          const today = new Intl.DateTimeFormat("en-CA", {
            timeZone: s.timezone,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date());
          const created = await api(
            this.env,
            "/agents/sessions",
            {
              agent_id: MAIN_AGENT_ID,
              agent: {
                tools: toolsFor(s.capabilities),
                multi_agent: { enabled: false },
              },
              environment: { type: "none" },
              stream: false,
              input: `当前日期：${today}；用户时区：${s.timezone}。客户端支持：${s.capabilities.join(",") || "纯文字，无本地存储"}。没有本地存储工具时只给草案，不声称保存。\n${s.input}`,
            },
            "travel-parent-" + this.ctx.id.toString(),
          );
          s.parent = created.id;
          s.activeUntil = Date.now() + TURN_LIMIT;
          s.input = "";
          s.status = "running";
          s.awaitingTurn = true;
          await this.save(s);
          return;
        }
        const pending = await this.ctx.storage.get<any>("pending");
        if (pending) {
          const event =
            pending.path === "/messages"
              ? {
                  type: "agent.session.input.message",
                  input: [
                    {
                      role: "user",
                      content: [{ type: "input_text", text: pending.input }],
                    },
                  ],
                }
              : {
                  type: "agent.session.input.tool_result",
                  turn_id: pending.action.turn_id,
                  call_id: pending.action.call_id,
                  success: pending.result.success,
                  ...(pending.result.success
                    ? { output: JSON.stringify(pending.result.output) }
                    : {
                        error: String(
                          pending.result.error ??
                            "Client did not complete action",
                        ).slice(0, 1000),
                      }),
                };
          await deliverEvent(
            this.env,
            s.parent,
            event,
            "travel-client-" + this.ctx.id.toString() + "-" + pending.key,
          );
          s.receipts[pending.key] = {
            fingerprint: pending.fingerprint,
            result: { accepted: true },
          };
          s.actions = s.actions.filter(
            (a) => a.call_id !== pending.action?.call_id,
          );
          if (pending.path === "/messages") s.awaitingTurn = true;
          await this.save(s);
          await this.ctx.storage.delete("pending");
        }
        const session = await api(this.env, `/agents/sessions/${s.parent}`);
        const actions = (session.required_actions ?? []).filter(
          (a: any) => a.type === "function_call",
        );
        s.actions = [];
        for (const call of actions) {
          if (typeof call.arguments === "string") {
            try {
              call.arguments = JSON.parse(call.arguments);
            } catch {
              call.arguments = {};
            }
          }
          if (SPECIALISTS[call.name]) {
            if (!s.jobs[call.call_id])
              s.jobs[call.call_id] = { call, started: Date.now(), attempts: 0 };
          } else if (CLIENT_TOOL_NAMES.has(call.name)) {
            if (call.name === "apply_local_trip_changes") {
              try {
                validateBatch(call.arguments);
              } catch {
                await this.returnResult(
                  s,
                  {
                    call,
                    started: Date.now(),
                    attempts: 0,
                    result: {
                      ok: false,
                      error: "INVALID_TABLE_CHANGES",
                      message:
                        "字段、版本或原子批次不符合本地表协议，请修正后重试。",
                    },
                  },
                  "validation",
                );
                continue;
              }
            }
            s.actions.push(call);
          } else {
            await this.returnResult(
              s,
              {
                call,
                started: Date.now(),
                attempts: 0,
                result: { ok: false, error: "UNKNOWN_TOOL" },
              },
              "unknown",
            );
          }
        }
        await this.save(s);
        // Each job writes its checkpoint before/after I/O. The mutex serializes other ticks;
        // independent specialists run concurrently within this tick.
        await Promise.all(
          Object.values(s.jobs)
            .filter((j) => !j.done)
            .map((j) => this.advance(s!, j)),
        );
        const items =
          (
            await api(
              this.env,
              `/agents/sessions/${s.parent}/items?limit=100&order=desc`,
            )
          ).data ?? [];
        s.messages = items
          .filter((i: any) => i.type === "message")
          .reverse()
          .map((i: any) => ({
            id: i.id,
            turn_id: i.turn_id,
            role: i.role,
            phase: i.phase,
            text: textOf(i),
          }));
        const newestTurn = items.find((i: any) => i.turn_id)?.turn_id;
        if (s.awaitingTurn && newestTurn && newestTurn !== s.lastTurn) {
          s.awaitingTurn = false;
          s.lastTurn = newestTurn;
        }
        const activeJobs = Object.values(s.jobs).some((j) => !j.done);
        if (s.actions.length && !activeJobs)
          s.status = "requires_client_action";
        else if (
          !activeJobs &&
          !actions.length &&
          !s.awaitingTurn &&
          newestTurn
        ) {
          const turn = await api(
            this.env,
            `/agents/sessions/${s.parent}/turns/${newestTurn}`,
          );
          if (
            turn.status === "completed" &&
            finalOf(items)?.turn_id === newestTurn
          )
            s.status = "completed";
          else if (["failed", "cancelled", "canceled"].includes(turn.status)) {
            s.status = "failed";
            s.error = "AGENT_TURN_" + turn.status.toUpperCase();
          }
        }
        if (s.status !== "failed") s.error = undefined;
        await this.save(s);
        await this.schedule(s);
      } catch (e) {
        s.error = e instanceof HttpError ? e.code : "TEMPORARY_UPSTREAM_ERROR";
        await this.save(s);
        await this.schedule(s, 10000);
      }
    });
  }
  private async returnResult(s: State, j: Job, suffix = "result") {
    await deliverEvent(
      this.env,
      s.parent!,
      {
        type: "agent.session.input.tool_result",
        turn_id: j.call.turn_id,
        call_id: j.call.call_id,
        success: true,
        output: JSON.stringify(j.result),
      },
      `travel-${suffix}-${j.call.call_id}`,
    );
    j.done = true;
    if (j.result?.ok !== false) j.error = undefined;
  }
  private async advance(s: State, j: Job) {
    try {
      if (!j.result && Date.now() - j.started > 10 * 60000) {
        j.result = {
          ok: false,
          error: "SPECIALIST_TIMEOUT",
          agent: j.call.name,
        };
        j.error = "SPECIALIST_TIMEOUT";
      }
      if (j.result) {
        if (JSON.stringify(j.result).length > 250000) {
          j.result = {
            ok: false,
            error: "SPECIALIST_RESULT_TOO_LARGE",
            agent: j.call.name,
          };
          j.error = "SPECIALIST_RESULT_TOO_LARGE";
        }
        await this.returnResult(s, j);
        delete j.result;
        await this.save(s);
        return;
      }
      if (!j.child) {
        const request = j.call.arguments?.request;
        if (
          !request ||
          typeof request !== "object" ||
          Array.isArray(request) ||
          typeof request.today !== "string" ||
          typeof request.tripId !== "string"
        ) {
          j.result = {
            ok: false,
            error: "INVALID_SPECIALIST_REQUEST",
            message: "request 必须包含 today 和 tripId",
          };
          await this.save(s);
          return;
        }
        const agent = await api(
          this.env,
          "/agents/" + SPECIALISTS[j.call.name],
        );
        const tools = (agent.tools ?? [])
          .filter((t: any) => ["web_search", "mcp"].includes(t.type))
          .map((t: any) =>
            t.type === "mcp"
              ? { ...t, allowed_tools: [...READ_ONLY_SUPPLY] }
              : t,
          );
        const created = await api(
          this.env,
          "/agents/sessions",
          {
            agent_id: SPECIALISTS[j.call.name],
            agent: { tools, multi_agent: { enabled: false } },
            vault_ids: await vaultsFor(this.env, tools),
            environment: { type: "none" },
            stream: false,
            input: JSON.stringify(request),
          },
          "travel-child-" + j.call.call_id,
        );
        j.child = created.id;
        await this.save(s);
        return;
      }
      const session = await api(this.env, `/agents/sessions/${j.child}`);
      if (session.required_actions?.length) {
        j.result = {
          ok: false,
          error: "SPECIALIST_REQUIRES_UNSUPPORTED_ACTION",
          agent: j.call.name,
        };
        j.error = "SPECIALIST_REQUIRES_UNSUPPORTED_ACTION";
        await this.save(s);
        return;
      }
      const items =
          (
            await api(
              this.env,
              `/agents/sessions/${j.child}/items?limit=100&order=desc`,
            )
          ).data ?? [],
        final = finalOf(items),
        turnId = items.find((i: any) => i.turn_id)?.turn_id;
      if (!turnId) return;
      const turn = await api(
        this.env,
        `/agents/sessions/${j.child}/turns/${turnId}`,
      );
      if (["failed", "cancelled", "canceled"].includes(turn.status)) {
        j.result = {
          ok: false,
          error: "SPECIALIST_FAILED",
          agent: j.call.name,
        };
        j.error = "SPECIALIST_FAILED";
      } else if (turn.status === "completed" && final) {
        const text = textOf(final);
        try {
          const data = JSON.parse(
            text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
          );
          if (!data || typeof data !== "object" || Array.isArray(data))
            throw Error();
          j.result = { ok: true, agent: j.call.name, data };
        } catch {
          j.result = {
            ok: false,
            error: "INVALID_SPECIALIST_JSON",
            agent: j.call.name,
            summary: text.slice(0, 6000),
          };
          j.error = "INVALID_SPECIALIST_JSON";
        }
      }
      await this.save(s);
    } catch (e) {
      j.attempts++;
      j.error = e instanceof HttpError ? e.code : "SPECIALIST_NETWORK_ERROR";
      if (j.attempts >= 4 && !j.result)
        j.result = { ok: false, error: j.error, agent: j.call.name };
      await this.save(s);
    }
  }
}
