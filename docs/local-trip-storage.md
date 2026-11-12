# Agent 如何写用户本地的五张表

字段来源：[行程规划表](https://app.notion.com/p/pushen/416fdd4befa18014a7c5cf089c617993)，读取于 2026-11-12。主表、机票、酒店、火车大巴、POI 保持原字段名称。可执行校验与参考事务逻辑见 [local-store.ts](../src/travel/local-store.ts)。

流程是：主 Agent 获取查询结果 → 用户选定或要求定稿 → 读取本地快照 → 生成变更批次 → 客户端校验并提交本地事务 → 回传保存回执 → 主 Agent 告知保存成功。

主 Agent 负责组装行，不把子 Agent 原始 JSON 整包写表。Worker 校验写入结构；最终校验、ID、系统时间和数据库事务均由 App 执行。App 未开发时，可以调用参考 reducer 模拟保存；这不代表已保存到真实用户设备。

## 原子批次

```json
{
  "operationId":"save-hangzhou-trip-001",
  "tripId":null,
  "expectedVersion":0,
  "changes":[
    {"table":"trips","action":"insert","ref":"TRIP-1","data":{"tripName":"杭州两日游","startDate":"2026-11-20","endDate":"2026-11-21","status":"规划中"}},
    {"table":"hotels","action":"insert","ref":"HOTEL-1","data":{"hotelName":"来自已核实静态结果的名称","hotelStatus":"planned","latitude":null,"longitude":null}}
  ],
  "sidecars":[{"ref":"HOTEL-1","kind":"hotel_stay","data":{"checkInDate":"2026-11-20","checkOutDate":"2026-11-21"}}]
}
```

- `tripId:null` 表示新行程，批次须有且只有一条主表 insert。App 生成实际 ID 并一次性填入所有子表；临时 ref 只用于回执映射。
- 已有行程先读版本；update/delete 指明 recordId。只允许更新给出的业务字段，拒绝系统字段和未知列。合并后的完整行再校验。
- 同一个 operationId 和内容重复提交返回原回执；同 ID 不同内容拒绝。版本不一致返回 VERSION_CONFLICT，Agent 重新读取后再提修改。
- 将五张表、版本、附加信息和幂等回执放在**同一个本地数据库事务**中提交，任何一行失败全部回滚。参考 reducer 只计算结果，实际磁盘写入由未来客户端实现。
- receipt idMap 包含新行的实际 ID；上报之前必须已提交事务。表与记录的版本在 App 本地管理。

## 字段边界

- 经纬度按文档总则和现有主提示词允许同时为空；有值必须成对且在范围内。地图展示前另行验证 WGS84 来源并补齐。Notion 部分字段表标“必填”与总则存在差异，此实现按总则处理。
- 价格和币种一起有或一起空，0 元也必须有币种。航班仅单人单航段含税价；酒店用整次入住总价。来源语义由主 Agent 和未来客户端根据报价证据核查，数字校验本身不能证明实时价格正确。
- 时间必须带时区偏移，按实际时间比较先后。POI 到访起止一起填写。
- 酒店的 checkinFrom/checkoutTo 是政策钟点，不是入住日期。入住日期、供应商酒店 ID 存 sidecars.hotel_stay；报价、票务、warnings 也放附加信息。可后续单独决定是否给酒店表正式增加 checkInDate/checkOutDate。
- HTML 保留原文，但客户端渲染前必须消毒；设施重复项保留，酒店图片最多 5 张。
- 候选不写正式表，选定不代表已预订。无订单凭证不得写 bookingReference，不得把查询结果标记为已出票。

当前接口一次修改一个行程。不提供跨设备同步或云端表存储；云端会话仍会处理用户授权传入的行程内容。
