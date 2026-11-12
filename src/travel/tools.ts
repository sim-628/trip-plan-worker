import manifest from "../../agents/manifest.json";
import cards from "../../agents/card-tools.json";
export const MAIN_AGENT_ID = manifest.mainAgent.id;
export const SPECIALISTS = Object.fromEntries(
  Object.entries(manifest)
    .filter(([name]) => name !== "mainAgent")
    .map(([name, a]) => [name, a.id]),
);
const descriptions: Record<string, string> = {
  attractionAgent: "查询景点、地标、博物馆、公园、商圈，返回结构化地点候选。",
  restaurantAgent: "查询餐厅、咖啡馆、小吃，返回结构化餐饮候选。",
  tourAgent: "查询一日游、体验、演出和已确定景点的门票；不预订。",
  hotelSearchAgent: "查询酒店与实时房价，或复核选定酒店的价格和入住人数。",
  hotelStaticInfoAgent:
    "酒店选定后查询静态详情，供主 Agent 组装酒店表；需要酒店名称及可用的酒店 ID。",
  flightAgent: "查询或比较航班，输入出发地、目的地、日期、人数与偏好；不下单。",
  transAgent:
    "查询火车、高铁、大巴班次；输入 legs、passengers、preferences 等；不购票。",
};
export const SPECIALIST_TOOLS = Object.keys(SPECIALISTS).map((name) => ({
  type: "function",
  name,
  description:
    descriptions[name] +
    " 将符合该子 Agent 输入约定的完整 JSON 放入 request，必须带 today 和 tripId。",
  parameters: {
    type: "object",
    properties: {
      request: {
        type: "object",
        properties: {
          today: { type: "string", description: "YYYY-MM-DD 当前日期" },
          tripId: { type: "string" },
        },
        required: ["today", "tripId"],
        additionalProperties: true,
      },
    },
    required: ["request"],
    additionalProperties: false,
  },
}));
export const LOCAL_TOOLS = [
  {
    type: "function",
    name: "read_local_trip",
    description:
      "让客户端读取用户本地行程。未知版本或修改已有行前必须读取；客户端返回 version 与五张表。",
    parameters: {
      type: "object",
      properties: { tripId: { type: ["string", "null"] } },
      required: ["tripId"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "apply_local_trip_changes",
    description:
      "向客户端申请原子保存本地行程。只有用户选定或要求定稿后调用。系统 ID 和时间由客户端生成。必须等待 applied 回执才能宣称已保存。缺字段不能写。",
    parameters: {
      type: "object",
      properties: {
        operationId: { type: "string" },
        tripId: { type: ["string", "null"] },
        expectedVersion: { type: "integer", minimum: 0 },
        sidecars: {
          type: "array",
          maxItems: 100,
          items: {
            type: "object",
            properties: {
              ref: { type: "string" },
              kind: {
                type: "string",
                enum: ["hotel_stay", "quote", "ticket", "warnings"],
              },
              data: { type: "object", additionalProperties: true },
            },
            required: ["ref", "kind", "data"],
            additionalProperties: false,
          },
        },
        changes: {
          type: "array",
          minItems: 1,
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              table: {
                type: "string",
                enum: ["trips", "flights", "hotels", "transports", "pois"],
              },
              action: { type: "string", enum: ["insert", "update", "delete"] },
              ref: { type: "string" },
              recordId: { type: "string" },
              data: { type: "object", additionalProperties: true },
            },
            required: ["table", "action", "ref"],
            additionalProperties: false,
          },
        },
      },
      required: ["operationId", "tripId", "expectedVersion", "changes"],
      additionalProperties: false,
    },
  },
];
export const CARD_TOOLS = Array.isArray(cards) ? cards : (cards as any).tools;
export function toolsFor(capabilities: string[]) {
  return [
    ...SPECIALIST_TOOLS,
    ...(capabilities.includes("cards") ? CARD_TOOLS : []),
    ...(capabilities.includes("local_trip_storage") ? LOCAL_TOOLS : []),
  ];
}
export const CLIENT_TOOL_NAMES = new Set(
  [...CARD_TOOLS, ...LOCAL_TOOLS].map((t: any) => t.name),
);
export const READ_ONLY_SUPPLY = new Set([
  "search_places",
  "search_nearby_places",
  "get_place_details",
  "search_restaurants",
  "ticket_search_products",
  "ticket_get_product_details",
  "ticket_get_sku_calendar",
  "ticket_check_availability",
  "ticket_list_categories",
  "ticket_list_countries",
  "ticket_list_cities",
  "search_train_tickets",
  "search_flight_tickets",
  "post_flights_rates",
  "get_data_flights_airports",
  "get_data_flights_airports_iatas_iatacode",
  "getHotelDetail",
  "getHotelStaticInfo",
]);
