# OpenAI Function Calling integration

This Worker is deliberately an independent tool-execution service. It does not create or manage an OpenAI Agent/Session.

1. Fetch the tool definitions from `GET /openai/tools` using your server-side bearer token, or import the definitions from `src/tools/definitions.ts` into your agent project.
2. Register those definitions as function tools on your OpenAI Agent.
3. When the model emits a function call, execute it from your trusted backend:

```http
POST /tools/execute
Authorization: Bearer <APP_API_TOKEN>
Content-Type: application/json

{
  "name": "search_places",
  "arguments": {
    "query": "museums in Kyoto",
    "location": null,
    "radius_meters": null,
    "limit": 10,
    "language_code": "en",
    "region_code": "JP",
    "included_type": "museum",
    "open_now": null
  }
}
```

4. Return the JSON response's `output` to OpenAI as the matching function-call output, preserving the original call ID and the API's required response protocol.

Do not expose `APP_API_TOKEN` or `GOOGLE_MAPS_API_KEY` in the iOS app. Your iOS app should call your authenticated application backend, not this Worker with a long-lived secret embedded in the binary.

## Responses API tool shape

The endpoint returns Responses API-style function tool definitions. If using the OpenAI Agents SDK, adapt/register the same name, description, and JSON schema using the SDK's function-tool interface. The SDK's local function execution callback is different from a remote Responses API tool-output event; do not mix the two protocols.
