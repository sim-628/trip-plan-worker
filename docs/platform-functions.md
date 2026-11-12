# OpenAI Platform 函数配置

主 Agent：`agent_6af58877aba081919f47f36febadd36f`。子 Agent ID 映射在 [manifest](../agents/manifest.json)。

本仓库使用 **Agents API 已保存 Agent**，不是旧 Assistants API，也不是 Agent Builder 工作流。

## 在 Platform 手动配置

1. 打开当前项目下的主 Agent 配置页，在 Tools 区域添加 Function。
2. 每个函数的 `name`、`description`、`parameters` 按 [functions 目录](../agents/functions) 对应 JSON 填入；若界面提供完整 JSON 编辑器，可粘贴单个文件。不要把整个数组粘进单个函数。
3. 七个必要函数：attractionAgent、flightAgent、hotelSearchAgent、hotelStaticInfoAgent、restaurantAgent、tourAgent、transAgent。名称大小写必须完全一致。
4. 展示卡片需要五个 `present_*_cards` 函数；本地读写需要 `read_local_trip`、`apply_local_trip_changes`。接口根据客户端声明的 capabilities 选择本次会话实际启用哪些函数。
5. 主 Agent 的 Instructions 使用 [mainAgent.md](../agents/mainAgent.md)。主 Agent 不配置供应商 MCP；这些保留在对应子 Agent 中。原生 Multi-agent 无须开启：固定 Agent 调度由 Worker 完成。
6. 保存后新建会话，已有会话不会自动获得新版定义。

七个函数都接收 `{"request":{...}}`，例如：

```json
{"request":{"today":"2026-11-12","tripId":"TRIP-1","legs":[{"departure":"杭州","arrival":"黄山","date":"2026-11-20"}],"transportTypes":["train"],"passengers":{"adults":1},"preferences":{"seatClass":"二等座"}}}
```

## 直接同步配置

[main-tools.json](../agents/main-tools.json) 是全部 14 个函数定义。已生成的文件可以直接查看、复制，无需运行脚本。定义的维护源在 `src/travel/tools.ts`；更改后运行 `node scripts/export-tools.mjs` 重新生成。

使用环境变量 OPENAI_API_KEY，运行 `python3 scripts/configure-main-agent.py` 可同步主 Agent；脚本先备份原配置到已忽略的 `.local-backups/`。不要把 API Key 放进 GitHub、提示词或函数参数。

## 执行入口

函数配置声明“可以调用什么”，不会自动连接某个 Worker URL。客户端必须调用本仓库的 `/travel/v1/sessions`，由 Worker 持续处理 required_actions、启动固定子 Agent、带上对应 vault，并把结果交回主 Agent。

Platform 内直接运行主 Agent 或调用旧 `/agents/sessions` 转发入口，不会启动本仓库新增的调度流程。需要通过新接口验证真实串联。客户端负责卡片展示及本地数据库保存；Worker 负责七个子 Agent，不能伪造客户端保存回执。

官方接口依据：[Function tools](https://developers.openai.com/api/docs/guides/agents-api/tools/functions)、[Update agent](https://developers.openai.com/api/reference/resources/beta/subresources/agents/methods/update)。
