# 旅行 Agent 接口 v1

入口：`https://trip-plan-worker.zhengpushen.workers.dev/travel/v1`。

所有请求携带现有 `Authorization: Bearer <IOS_GATEWAY_TOKEN 或 APP_API_TOKEN>`。每个会话另有 `X-Session-Token`，只由创建者保存。当前共用网关令牌适合开发接入；上线 App 前要接用户登录、按用户限流及会话归属验证，不要把共用管理员令牌写死在公开 App 中。旧 `/agents/*` 是原有管理型代理，未来面向用户上线应关闭或限制。

## 创建

`POST /sessions`，必需 `Idempotency-Key`（16–100 位字母、数字、横线、下划线；重试使用同一个值）。

```json
{"input":"查2026年11月20日杭州到黄山的高铁，1名成人，只做比较","timezone":"Asia/Shanghai","capabilities":[]}
```

202 响应包含 `id`、`session_token`、`status`。相同网关身份和幂等键返回同一个会话，不会重复创建；同键不同内容返回 409。

capabilities 可选 `cards`、`local_trip_storage`。不填时仅文字；即使没有 App，也能查供给并得到草案。有本地数据库执行器后再启用 local_trip_storage。

## 读取进度

`GET /sessions/{id}`，加上 `X-Session-Token`。约每 3–5 秒轮询。

- `status`: starting / running / requires_client_action / completed / failed。
- `messages`: 最近最多 100 条历史项中的用户及助手消息，包含 id、turn_id、phase、text。按 id 去重，不要把 commentary 当最终结果。
- `dispatches`: 七个子 Agent 的调用名、call_id、状态和失败代码。
- `required_actions`: 仅需客户端处理的函数调用；后台子 Agent 调用不会交给客户端。
- `expires_at`: 本接口的会话协调状态保存 7 天，到期失效。这不表示 OpenAI 上的会话历史也被删除。

后台通过 Durable Object alarms 继续执行，不依赖手机前台或长连接。每轮最多 15 分钟，单个子 Agent 最多 10 分钟；超时明确失败。供应商查询能力受其可用性、权限与覆盖范围影响。

## 继续对话

`POST /sessions/{id}/messages`，携带会话令牌和新的 Idempotency-Key：`{"input":"只看上午的班次"}`。只在上一轮 completed 时提交，否则返回 409，避免并发覆盖用户意图。

## 客户端动作回执

`POST /sessions/{id}/results`，携带会话令牌和 Idempotency-Key。

```json
{"call_id":"从 required_actions 原样取","success":true,"output":{"status":"applied","operationId":"来自写表参数","tripId":"本地实际ID","version":1,"idMap":{"TRIP-1":"本地实际ID"}}}
```

失败时发送 `{"call_id":"...","success":false,"error":"VERSION_CONFLICT"}`。卡片仅在真实渲染后返回展示成功；写表仅在数据库事务提交后返回 applied。接口会核对 call_id、动作归属、operationId、tripId、version 和新记录 ID 映射。收到 202 表示回执进入处理队列，轮询等待下一步。

客户端不能提交七个后台函数的结果。用户表内容不会落到 Worker 的正式业务数据库；会话上下文、待执行的写表请求和必要回执会参与云端 Agent 对话及短期协调存储。因此“表存本地”不等于“表内容从不进入云端模型”。

请求体上限 128 KiB；不支持预订、支付、出票、改签、退款。专用 Agent 仅开放查询类供应商工具。

## 部署

`pnpm install --frozen-lockfile`、`pnpm typecheck`、`pnpm test`、`pnpm exec wrangler deploy --dry-run` 后部署。`wrangler.toml` 中的首次迁移创建 TRAVEL_SESSIONS SQLite Durable Object；后续部署沿用此迁移。保留现有五个 secret，不要提交 secret 值。已有 `/health`、`/mcp`、`/tools` 和旧接口保持兼容。
