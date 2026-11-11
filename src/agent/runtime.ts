import { Env, HttpError } from "../types";
import { executeTool } from "../tools/dispatcher";
import { createSession, openEventStream, submitEvents, retrieveSession } from "./openai";

type Action = {
  type: string;
  turn_id: string;
  call_id: string;
  name: string;
  arguments: unknown;
};

function parseArgs(value: unknown): Record<string, any> {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Function arguments must be a JSON object");
  }
  return parsed as Record<string, any>;
}

async function resolveActions(env: Env, sessionId: string) {
  const session = await retrieveSession(env, sessionId);
  const actions = (session.required_actions || []) as Action[];
  const calls = actions.filter((action) => action.type === "function_call");
  if (actions.some((action) => action.type !== "function_call")) {
    throw new HttpError(409, "Unsupported required action in managed session", "UNSUPPORTED_REQUIRED_ACTION");
  }

  const outputs = await Promise.all(calls.map(async (action) => {
    try {
      const result = await executeTool(action.name, parseArgs(action.arguments), env);
      return {
        type: "agent.session.input.tool_result",
        turn_id: action.turn_id,
        call_id: action.call_id,
        success: true,
        output: JSON.stringify(result),
      };
    } catch (error) {
      return {
        type: "agent.session.input.tool_result",
        turn_id: action.turn_id,
        call_id: action.call_id,
        success: false,
        error: error instanceof Error ? error.message : "Tool execution failed",
      };
    }
  }));
  if (outputs.length) await submitEvents(env, sessionId, outputs);
}

function eventPayload(frame: string): any | null {
  const data = frame.split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return null;
  try { return JSON.parse(data); } catch { return null; }
}

export function relayAndExecute(
  env: Env,
  sessionId: string,
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let pending = "";
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          controller.enqueue(part.value);
          pending += decoder.decode(part.value, { stream: true });
          let splitAt: number;
          while ((splitAt = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, splitAt);
            pending = pending.slice(splitAt + 2);
            const event = eventPayload(frame);
            if (event?.type === "agent.session.requires_action" ||
                event?.type === "agent.session.action_required") {
              await resolveActions(env, sessionId);
            }
          }
        }
        if (pending.trim()) {
          const event = eventPayload(pending);
          if (event?.type === "agent.session.requires_action" ||
              event?.type === "agent.session.action_required") {
            await resolveActions(env, sessionId);
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent stream failed";
        controller.enqueue(new TextEncoder().encode(
          "event: trip_plan.error\ndata: " + JSON.stringify({ message }) + "\n\n",
        ));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

export async function startSessionStream(
  env: Env,
  input: string,
  model: string,
  instructions: string,
) {
  const upstream = await createSession(env, input, model, instructions);
  if (!upstream.body) throw new HttpError(502, "OpenAI did not return an event stream", "OPENAI_STREAM_ERROR");
  // The streamed create response includes the initial session ID in its session-created event.
  // The caller parses that ID from the stream and persists it for follow-up turns.
  return upstream;
}

export async function continueSessionStream(
  env: Env,
  sessionId: string,
  message: string,
  idempotencyKey: string,
) {
  const stream = await openEventStream(env, sessionId);
  await submitEvents(env, sessionId, [{
    type: "agent.session.input.message",
    role: "user",
    content: message,
  }], idempotencyKey);
  return relayAndExecute(env, sessionId, stream);
}

export function relayCreatedSession(
  env: Env,
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let pending = "";
      let sessionId: string | null = null;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          controller.enqueue(part.value);
          pending += decoder.decode(part.value, { stream: true });
          let splitAt: number;
          while ((splitAt = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, splitAt);
            pending = pending.slice(splitAt + 2);
            const event = eventPayload(frame);
            if (!event?.type) continue;
            if (event.type === "agent.session.created") {
              sessionId = event.session?.id || event.data?.id || event.session_id || sessionId;
            }
            if ((event.type === "agent.session.requires_action" ||
                 event.type === "agent.session.action_required") && sessionId) {
              await resolveActions(env, sessionId);
            }
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Agent stream failed";
        controller.enqueue(new TextEncoder().encode(
          "event: trip_plan.error\ndata: " + JSON.stringify({ message, session_id: sessionId }) + "\n\n",
        ));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}
