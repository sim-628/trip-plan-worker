# 浏览器旅行测试台

入口：`https://trip-plan-worker.zhengpushen.workers.dev/test/`。

通过专属链接进入后，即可和主 Agent 对话，不需要 App，也不需要输入 OpenAI API Key。网页使用新旅行接口，展示七个固定子 Agent 的执行进度。

## 使用

- 输入旅行需求，或点首页的四个示例填入输入框，再发送。
- 左侧开启新对话、切换历史对话；手机上使用顶部「＋」，历史记录在「行程与进度」中。
- 查询可能需要数分钟；刷新后会恢复当前对话，并继续读取后台任务。
- 主 Agent 提议写表时，网页显示待保存内容。点「保存到此浏览器」后才提交本地事务，再告诉主 Agent 已保存；「暂不保存」会回传取消结果。
- 右侧查看五张表，选择已有行程作为当前对话的本地行程，或导出 JSON。
- 会话记录、五张表、版本及保存回执存于该浏览器 IndexedDB。不同浏览器不自动同步；清除浏览器数据会丢失这些本地内容。对话和用户授权读取的行程内容仍会进入云端模型。

## 访问与凭证

单独的 `TEST_UI_ACCESS_CODE` secret 只用于测试网页。访问链接的 `#access=...` 片段在前端读取后立即移除，并换取 7 天的签名 HttpOnly、Secure、SameSite=Strict Cookie。片段不作为页面 HTTP 请求的一部分发送。专属链接拥有测试访问权限，请仅用于自己的测试。

网页只代理 `/travel/v1/sessions` 下的固定接口。OpenAI 密钥和原网关管理令牌在 Worker 服务端注入，不写入前端文件或 GitHub。访问码与真实会话令牌也不提交到 GitHub。管理员可轮换 TEST_UI_ACCESS_CODE 撤销旧链接和 Cookie。

## 开发与检查

- `pnpm build:web`：编译网页与本地表校验逻辑；生成的 assets.generated.ts 已忽略。
- `pnpm dev`：启动本地 Worker。可以在忽略的 `.dev.vars` 中配置开发访问码；不要使用生产管理密钥作为网页访问码。
- `pnpm typecheck`、`pnpm test`：检查服务端、浏览器代码和 Worker 运行时。
- 本地 Worker 启动后，`pnpm test:browser`：使用 Chrome 执行浏览器测试。模型请求使用测试响应，覆盖保存确认、IndexedDB 持久化、刷新恢复、断线重试、卡片内容与手机布局；与生产真实对话验收分开。
- `pnpm build`、`pnpm deploy` 会先编译网页。部署保留已有 Worker secret、供应商接口及 Durable Object。

设计采用浅纸色、深绿色和三栏布局：左侧对话，中间聊天，右侧执行进度与本地数据；手机上右栏折叠为抽屉。不依赖外部字体或远程脚本。
