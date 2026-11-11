# Managed OpenAI Agents API integration

The Worker now exposes a thin managed Agents API gateway and automatically dispatches Google function calls.

## Secrets

Add these Worker secrets:

\`\`\`bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put APP_API_TOKEN
npx wrangler secret put GOOGLE_MAPS_API_KEY
\`\`\`

The OpenAI project key must have the Agents API permissions required to create/read sessions and submit model/tool-result events. Send the OpenAI-Beta: agents=v1 header; this Worker does so automatically.

## Endpoints

All endpoints except GET /health require Authorization: Bearer APP_API_TOKEN.

| Method | Path | Purpose |
|---|---|---|
| GET | /health | Health check |
| GET | /openai/tools | Function tool definitions |
| POST | /tools/execute | Execute one Google function |
| POST | /agent/sessions | Create a managed session, submit first message and stream events |
| POST | /agent/sessions/{session_id}/messages | Continue an existing session and stream events |
| GET | /agent/sessions/{session_id} | Retrieve session state, including pending required_actions |
| GET | /agent/sessions/{session_id}/events | Reconnect to the live event stream and dispatch any newly observed function calls |

### Create a session

\`\`\`bash
curl -N "$WORKER_URL/agent/sessions" \\
  -H "Authorization: Bearer $APP_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"input":"Find highly rated sushi restaurants in Shinjuku.","model":"gpt-5.4"}'
\`\`\`

The response is an SSE stream. Save the session ID from the agent.session.created event (session.id). Keep reading events until the root turn completes, fails or is cancelled.

### Continue a session

\`\`\`bash
curl -N "$WORKER_URL/agent/sessions/$SESSION_ID/messages" \\
  -H "Authorization: Bearer $APP_API_TOKEN" \\
  -H "Idempotency-Key: $UNIQUE_MESSAGE_ID" \\
  -H "Content-Type: application/json" \\
  -d '{"message":"Only show places suitable for a date."}'
\`\`\`

Use the same idempotency key only when retrying the same logical user message. Generate a new key for every new message.

### Tool execution lifecycle

When the session stream emits agent.session.requires_action, the Worker retrieves the session and reads its current required_actions. It runs each pending function_call and submits matching agent.session.input.tool_result events with the original turn_id and call_id. The model then continues the turn.

The event stream is passed through to the caller. The iOS app should treat it as a stream of typed events, not as a single JSON response. Use agent.session.turn.completed, agent.session.turn.failed, and agent.session.turn.cancelled to determine the turn outcome. An idle session by itself is not proof of success.

## Security and production notes

- Keep OPENAI_API_KEY, GOOGLE_MAPS_API_KEY and APP_API_TOKEN in Cloudflare Worker secrets only.
- Do not put APP_API_TOKEN or OPENAI_API_KEY in the iOS app. Authenticate iOS users to your application backend (for example, Supabase JWT) and call this Worker server-to-server.
- The starter currently uses one shared APP_API_TOKEN for trusted backend-to-worker calls. Add Supabase JWT validation and per-user authorization/quotas before exposing the API to multiple users.
- ALLOWED_ORIGIN = "*" is not authentication. Restrict CORS if browser clients call the Worker.
- The initial implementation executes parallel pending function calls with Promise.all. Add a bounded concurrency limit and durable deduplication keyed by session_id + turn_id + call_id before production.
- If the stream disconnects, retrieve the session and inspect required_actions before retrying. Do not blindly re-submit the user message.
- The current stream handler resolves function_call actions only. Other required action types must be surfaced to the application for user approval or handled by a dedicated handler.
- No Durable Objects are needed for the first version. Add a durable queue/workflow or per-session coordinator only when you implement reliable webhook recovery and concurrent session locking.

## Google / Apple map boundary

Google Places, Geocoding and Routes content must not be drawn as markers or route overlays on Apple MapKit. Use Apple MapKit/Apple Maps data or a provider whose licence explicitly permits use on Apple maps.
