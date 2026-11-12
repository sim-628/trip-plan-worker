import {
  getThread,
  listThreads,
  updateThread,
  listTrips,
  getTrip,
  emptyTrip,
  actionResult,
  cacheFailure,
  type Thread,
} from "./storage";
import { markdown, safeURL } from "./markdown";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const AGENTS = [
  ["flightAgent", "航班", "↗"],
  ["transAgent", "火车与大巴", "⇄"],
  ["hotelSearchAgent", "酒店比价", "⌂"],
  ["hotelStaticInfoAgent", "酒店资料", "▤"],
  ["attractionAgent", "景点", "✳"],
  ["restaurantAgent", "餐厅", "♧"],
  ["tourAgent", "门票与体验", "◇"],
];
const TABLES: Record<string, string> = {
  trips: "行程",
  flights: "机票",
  hotels: "酒店",
  transports: "交通",
  pois: "地点",
};
let active = localStorage.getItem("trip-active-chat") ?? "",
  tab = "trips",
  online = false,
  polling = false,
  renderKey = "",
  timer: ReturnType<typeof setTimeout> | undefined;
const sending = new Set<string>(),
  delivering = new Set<string>();
function node(tag: string, className = "", text?: string) {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function toast(text: string) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  setTimeout(() => ($("toast").hidden = true), 3500);
}
function connected(value: boolean) {
  online = value;
  $("connection-dot").className = "dot " + (value ? "online" : "offline");
  $("connection-label").textContent = value ? "已连接旅行助手" : "等待重新连接";
}
function loginVisible() {
  if (timer) clearTimeout(timer);
  $("app").hidden = true;
  $("login").hidden = false;
  connected(false);
}
async function api(
  path: string,
  body?: unknown,
  session?: Thread["session"],
  key?: string,
) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch("/test/api" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        ...(session ? { "X-Session-Token": session.session_token } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== "/login") loginVisible();
      throw Error(data.error?.message ?? "请求未能完成");
    }
    connected(true);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
function busy(t: Thread) {
  return (
    !!t.pending ||
    ["starting", "running", "requires_client_action"].includes(t.status)
  );
}
async function newChat() {
  const t: Thread = {
    id: crypto.randomUUID(),
    title: "新的旅行想法",
    created: Date.now(),
    updated: Date.now(),
    timezone: $<HTMLSelectElement>("timezone").value,
    status: "draft",
    messages: [],
    dispatches: [],
    required_actions: [],
    cards: {},
    results: {},
    tripId: null,
  };
  await updateThread(t.id, t);
  await selectChat(t.id);
  $<HTMLTextAreaElement>("message-input").focus();
}
async function selectChat(id: string) {
  active = id;
  localStorage.setItem("trip-active-chat", id);
  renderKey = "";
  const thread = await getThread(id);
  if (!thread) {
    await newChat();
    return;
  }
  $<HTMLSelectElement>("timezone").value = thread.timezone;
  await render();
  schedule(10);
}
async function renderHistory() {
  const history = $("history");
  history.replaceChildren();
  const threads = await listThreads();
  const mobile = $<HTMLSelectElement>("history-select");
  mobile.replaceChildren();
  for (const t of threads) mobile.add(new Option(t.title, t.id));
  mobile.value = active;
  for (const t of threads) {
    const b = node(
      "button",
      "history-item" + (t.id === active ? " active" : ""),
      t.title,
    ) as HTMLButtonElement;
    b.title = t.title;
    b.onclick = () => selectChat(t.id);
    history.append(b);
  }
  if (!threads.length)
    history.append(node("p", "history-empty", "新的想法，从这里开始。"));
}
function visibleMessage(message: any) {
  const text =
    message.role === "user"
      ? String(message.text ?? "").replace(
          /^当前日期：[^\n]*客户端支持：[^\n]*\n/,
          "",
        )
      : String(message.text ?? "");
  return { ...message, text };
}
function mergeMessages(old: any[], fresh: any[]) {
  const messages = old.map(visibleMessage);
  const incoming = fresh.map(visibleMessage);
  const key = (m: any) => m.id ?? m.role + ":" + m.text;
  for (let i = 0; i < incoming.length; i++) {
    const message = incoming[i];
    // Some session responses omit user input. The browser's durable copy is
    // authoritative, including separate turns that happen to repeat the text.
    if (
      message.role === "user" &&
      messages.some(
        (m) => m.local && m.role === "user" && m.text === message.text,
      )
    )
      continue;
    const existing = messages.findIndex((m) => key(m) === key(message));
    if (existing >= 0) messages[existing] = message;
    else {
      const next = incoming
        .slice(i + 1)
        .find((m) => messages.some((saved) => key(saved) === key(m)));
      const index = next
        ? messages.findIndex((m) => key(m) === key(next))
        : messages.length;
      messages.splice(index, 0, message);
    }
  }
  return messages.slice(-200);
}
function drawCards(host: HTMLElement, cards: Thread["cards"]) {
  for (const call of Object.values(cards)) {
    const grid = node("div", "cards");
    for (const item of call.arguments?.cards ?? []) {
      const card = node("article", "result-card");
      const title =
        item.hotel_name ??
        item.hotelName ??
        item.name ??
        item.title ??
        item.airline ??
        item.flight_number ??
        "查询结果";
      const imageURL = safeURL(item.image_url ?? item.image?.url);
      if (imageURL) {
        const img = document.createElement("img");
        img.src = imageURL;
        img.alt = String(title);
        img.loading = "lazy";
        img.referrerPolicy = "no-referrer";
        card.append(img);
      }
      card.append(node("h3", "", String(title)));
      const add = (value: unknown) => {
        if (value !== undefined && value !== null && value !== "")
          card.append(
            node(
              "p",
              "",
              Array.isArray(value) ? value.join(" · ") : String(value),
            ),
          );
      };
      if (call.name === "present_flight_cards") {
        add(
          [item.flight_number, item.cabin, item.stop_summary]
            .filter(Boolean)
            .join(" · "),
        );
        add(
          `${item.origin_name ?? item.origin_code ?? ""} → ${item.destination_name ?? item.destination_code ?? ""}`,
        );
        add([item.depart_at, item.arrive_at].filter(Boolean).join(" → "));
        add(item.duration_label);
      }
      if (call.name === "present_hotel_cards") {
        add([item.check_in, item.check_out].filter(Boolean).join(" — "));
        add(item.guest_summary);
      }
      for (const k of [
        "subtitle",
        "summary",
        "description",
        "address",
        "area",
        "highlight",
        "category",
        "cuisine",
        "package_name",
        "venue",
        "city",
        "date_label",
        "party_summary",
        "availability",
        "rules",
        "amenities",
      ])
        add(item[k]);
      for (const [field, label] of [
        ["nightly_price", "每晚"],
        ["total_price", "入住总价"],
        ["unit_price", "单价"],
        ["price", "报价"],
      ]) {
        const price = item[field];
        if (price?.amount != null)
          add(`${price.label ?? label}：${price.currency} ${price.amount}`);
      }
      if (item.rating != null)
        add(
          `评分 ${item.rating}${item.rating_count != null ? " · " + item.rating_count + "条评价" : ""}`,
        );
      if (item.open_now != null)
        add(item.open_now ? "目前营业中" : "目前非营业时间");
      add(item.price_level);
      add(item.price_note);
      const href = safeURL(
        item.booking_url ?? item.detail_url ?? item.url ?? item.website,
      );
      if (href) {
        const a = document.createElement("a");
        a.textContent = "查看详情 ↗";
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        card.append(a);
      }
      const details = node("details", "json-details"),
        summary = node("summary", "", "查看完整卡片数据"),
        pre = node("pre", "", JSON.stringify(item, null, 2));
      details.append(summary, pre);
      card.append(details);
      grid.append(card);
    }
    host.append(grid);
  }
}
function drawMessages(t: Thread) {
  const key = JSON.stringify([t.messages, t.optimistic, t.cards]);
  if (key === renderKey) return;
  renderKey = key;
  const scroll = $("message-scroll"),
    atBottom =
      scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 130,
    host = $("messages");
  host.replaceChildren();
  const messages = t.messages ?? [];
  for (const m of messages) {
    if (!m.text) continue;
    const article = node(
      "article",
      "message " +
        (m.role === "user"
          ? "user"
          : m.phase === "commentary"
            ? "commentary"
            : "assistant"),
    );
    if (m.role === "user") article.append(node("div", "user-bubble", m.text));
    else {
      const label = node("div", "message-label");
      label.append(
        node("span", "", "✳"),
        document.createTextNode("旅行规划助手"),
      );
      article.append(label, markdown(m.text));
    }
    host.append(article);
  }
  if (
    t.optimistic &&
    !messages.some((m) => m.role === "user" && m.text === t.optimistic)
  ) {
    const article = node("article", "message user");
    article.append(node("div", "user-bubble", t.optimistic));
    host.append(article);
  }
  drawCards(host, t.cards);
  $("welcome").hidden = messages.length > 0 || !!t.optimistic;
  if (atBottom)
    requestAnimationFrame(() => (scroll.scrollTop = scroll.scrollHeight));
}
function drawAgents(t: Thread) {
  const host = $("agents");
  host.replaceChildren();
  let count = 0;
  for (const [name, label, icon] of AGENTS) {
    const jobs = t.dispatches.filter((x) => x.name === name),
      running = jobs.some((x) => x.status !== "completed"),
      failed = jobs.some((x) => x.error && x.status === "completed"),
      state = running ? "active" : jobs.length ? "done" : "";
    if (jobs.length) count++;
    const row = node("div", "agent " + state + (failed ? " failed" : ""));
    row.append(
      node("span", "agent-icon", icon),
      node("span", "agent-name", label),
      node(
        "span",
        "agent-status",
        running
          ? "查询中"
          : failed
            ? "有提示"
            : jobs.length
              ? "已返回"
              : "未调用",
      ),
    );
    if (failed)
      row.title = jobs
        .filter((x) => x.error)
        .map((x) => x.error)
        .join(", ");
    host.append(row);
  }
  $("agent-count").textContent = count + " / 7";
}
async function drawTrip(t: Thread) {
  const trips = await listTrips();
  if (t.id !== active) return;
  const select = $<HTMLSelectElement>("trip-select");
  select.replaceChildren(new Option("新行程", ""));
  for (const trip of trips)
    select.add(
      new Option(trip.tables.trips[0]?.tripName ?? "未命名行程", trip.tripId!),
    );
  select.value = t.tripId ?? "";
  select.disabled = busy(t);
  const current = trips.find((s) => s.tripId === t.tripId),
    summary = $("trip-summary");
  summary.className = "trip-summary" + (current ? " has-trip" : "");
  summary.replaceChildren();
  if (current) {
    const trip = current.tables.trips[0];
    summary.append(
      node("p", "", trip?.tripName ?? "未命名行程"),
      node("small", "", `${trip?.startDate ?? ""} — ${trip?.endDate ?? ""}`),
      node(
        "small",
        "",
        `${trip?.status ?? ""} · 已保存 ${Object.values(current.tables).reduce((n, rows) => n + rows.length, 0)} 条记录`,
      ),
    );
  } else
    summary.append(
      node("span", "empty-icon", "▱"),
      node("p", "", "还没有保存的行程"),
      node("small", "", "对助手说「把它加入行程」，确认后会出现在这里。"),
    );
  const tabs = $("table-tabs");
  tabs.replaceChildren();
  for (const [name, label] of Object.entries(TABLES)) {
    const button = node(
      "button",
      "table-tab" + (tab === name ? " active" : ""),
      label +
        (current
          ? ` ${current.tables[name as keyof typeof current.tables].length}`
          : ""),
    );
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(tab === name));
    button.onclick = () => {
      tab = name;
      drawTrip(t);
    };
    tabs.append(button);
  }
  const records = $("table-records");
  records.replaceChildren();
  const rows = current?.tables[tab as keyof typeof current.tables] ?? [];
  for (const row of rows) {
    const article = node("article", "table-record");
    article.append(
      node(
        "div",
        "",
        String(
          row.tripName ??
            row.hotelName ??
            row.poiName ??
            row.flightNumber ??
            row.transportNumber ??
            row.operator ??
            "行程记录",
        ),
      ),
    );
    for (const field of [
      "address",
      "departureAirport",
      "arrivalAirport",
      "departureLocation",
      "arrivalLocation",
      "departureTime",
      "arrivalTime",
      "visitStartTime",
    ])
      if (row[field]) article.append(node("small", "", String(row[field])));
    if (row.price != null)
      article.append(node("small", "", `${row.currency} ${row.price}`));
    const detail = node("details", "json-details");
    detail.append(
      node("summary", "", "查看字段"),
      node("pre", "", JSON.stringify(row, null, 2)),
    );
    article.append(detail);
    records.append(article);
  }
  if (!rows.length)
    records.append(node("div", "table-empty", "这一张表暂时为空"));
  $<HTMLButtonElement>("export-trip").disabled = !current;
}
function drawAction(t: Thread) {
  const panel = $("tool-action"),
    call = t.required_actions.find(
      (a) => a.name === "apply_local_trip_changes" && !t.results[a.call_id],
    );
  panel.replaceChildren();
  panel.hidden = !call;
  if (!call) return;
  const counts: Record<string, number> = {};
  for (const c of call.arguments.changes ?? [])
    counts[c.table] = (counts[c.table] ?? 0) + 1;
  panel.append(
    node("h3", "", "这份行程准备好保存了"),
    node(
      "p",
      "",
      Object.entries(counts)
        .map(([k, v]) => `${TABLES[k] ?? k} ${v} 条变更`)
        .join(" · "),
    ),
    node("p", "", "确认后保存到当前浏览器，不会产生预订或付款。"),
  );
  const detail = node("details", "json-details");
  detail.append(
    node("summary", "", "查看待保存内容"),
    node("pre", "", JSON.stringify(call.arguments, null, 2)),
  );
  panel.append(detail);
  const buttons = node("div", "action-buttons");
  for (const [label, decision, cls] of [
    ["保存到此浏览器", "save", "primary"],
    ["暂不保存", "reject", "secondary"],
  ]) {
    const button = node("button", cls, label) as HTMLButtonElement;
    button.onclick = async () => {
      for (const b of buttons.querySelectorAll("button"))
        (b as HTMLButtonElement).disabled = true;
      await executeAction(t, call, decision as "save" | "reject");
    };
    buttons.append(button);
  }
  panel.append(buttons);
}
async function render() {
  const t = active ? await getThread(active) : null;
  if (!t) return;
  await renderHistory();
  $("conversation-title").textContent =
    t.title === "新的旅行想法" ? "和旅行规划助手聊聊" : t.title;
  drawMessages(t);
  drawAgents(t);
  drawAction(t);
  await drawTrip(t);
  const statuses: Record<string, string> = {
    draft: "",
    starting: "正在开启对话…",
    running: "助手正在整理信息，你可以在右侧查看查询进度。",
    requires_client_action: t.required_actions.some(
      (a) => a.name === "apply_local_trip_changes" && !t.results[a.call_id],
    )
      ? "请确认上方的本地保存内容。"
      : "正在同步结果…",
    completed: "本轮已完成，可以继续聊。",
    failed: "本轮未能完成，可以开启新对话重试。",
  };
  $("run-status").textContent = t.pending
    ? "正在发送…"
    : (statuses[t.status] ?? "");
  $("run-status").className =
    "run-status" + (["starting", "running"].includes(t.status) ? " busy" : "");
  $<HTMLButtonElement>("send").disabled =
    busy(t) ||
    t.status === "failed" ||
    !$<HTMLTextAreaElement>("message-input").value.trim();
  $<HTMLSelectElement>("timezone").disabled = !!t.session || !!t.pending;
  const error = $("error-banner");
  error.replaceChildren();
  error.hidden = !t.error;
  if (t.error) {
    error.append(document.createTextNode(t.error));
    const retry = node("button", "", "重新连接");
    retry.onclick = () => schedule(0);
    error.append(retry);
  }
}
async function deliver(t: Thread, result: any) {
  const key = t.id + result.call_id;
  if (delivering.has(key)) return;
  delivering.add(key);
  try {
    await api(
      `/sessions/${t.session!.id}/results`,
      result,
      t.session,
      "browser-" + result.call_id,
    );
  } finally {
    delivering.delete(key);
  }
}
async function executeAction(
  t: Thread,
  call: any,
  decision: "read" | "save" | "reject" | "card",
) {
  try {
    const result = await actionResult(t.id, call, decision);
    if (t.id === active) await render();
    if (decision === "card") await new Promise((r) => requestAnimationFrame(r));
    await deliver(t, result);
    if (decision === "save") toast("行程已保存到当前浏览器");
    await updateThread(t.id, { error: undefined });
  } catch (e) {
    const message = e instanceof Error ? e.message : "本地操作失败";
    if (["save", "read"].includes(decision)) {
      const existing = (await getThread(t.id)).results[call.call_id];
      if (!existing) {
        await cacheFailure(t.id, call.call_id, message);
        try {
          await deliver(t, (await getThread(t.id)).results[call.call_id]);
        } catch {}
      }
    }
    await updateThread(t.id, {
      error:
        message === "VERSION_CONFLICT"
          ? "本地行程已发生变化，助手将重新读取后再整理。"
          : "操作暂未完成，已保留当前数据。" + message,
    });
  } finally {
    if (t.id === active) await render();
    schedule(1200);
  }
}
async function sendPending(t: Thread) {
  if (!t.pending || sending.has(t.id)) return;
  sending.add(t.id);
  try {
    const p = t.pending,
      data = await api(
        t.session ? `/sessions/${t.session.id}/messages` : "/sessions",
        p.body,
        t.session,
        p.key,
      );
    await updateThread(t.id, {
      session: t.session ?? { id: data.id, session_token: data.session_token },
      pending: undefined,
      status: "running",
      error: undefined,
    });
  } catch (e) {
    connected(false);
    await updateThread(t.id, {
      error: "发送暂未确认，重连后会继续同一次请求，不会重复创建对话。",
    });
  } finally {
    sending.delete(t.id);
  }
}
function schedule(delay = 3500) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(poll, delay);
}
async function poll() {
  if (polling || !active || $("app").hidden) {
    schedule();
    return;
  }
  polling = true;
  const id = active;
  try {
    let t = await getThread(id);
    if (t.pending) {
      await sendPending(t);
      t = await getThread(id);
    }
    if (t.session && busy(t) && !t.pending) {
      const state = await api(
        `/sessions/${t.session.id}`,
        undefined,
        t.session,
      );
      await updateThread(id, {
        status: state.status,
        messages: mergeMessages(t.messages, state.messages ?? []),
        dispatches: state.dispatches ?? [],
        required_actions: state.required_actions ?? [],
        error:
          state.status === "failed"
            ? "这次任务未能完成（" +
              (state.error ?? "查询失败") +
              "）。请开启新对话。"
            : undefined,
        optimistic: (state.messages ?? [])
          .map(visibleMessage)
          .some((m: any) => m.role === "user" && m.text === t.optimistic)
          ? undefined
          : t.optimistic,
      });
      t = await getThread(id);
      if (id === active) await render();
      for (const call of t.required_actions) {
        if (t.results[call.call_id]) {
          await deliver(t, t.results[call.call_id]);
          continue;
        }
        if (call.name === "read_local_trip")
          await executeAction(t, call, "read");
        else if (call.name.startsWith("present_"))
          await executeAction(t, call, "card");
      }
    } else if (!t.session && !t.pending) await api("/me");
  } catch (e) {
    connected(false);
    await updateThread(id, {
      error: "连接暂时中断，后台查询会继续。正在自动重连…",
    });
  } finally {
    polling = false;
    if (id === active) await render();
    schedule(online ? 3500 : 6000);
  }
}
async function send() {
  const input = $<HTMLTextAreaElement>("message-input").value.trim();
  if (!input) return;
  if (!active) await newChat();
  const t = await getThread(active);
  if (busy(t) || t.status === "failed") return;
  const body = t.session
    ? { input }
    : {
        input,
        timezone: $<HTMLSelectElement>("timezone").value,
        capabilities: ["cards", "local_trip_storage"],
      };
  await updateThread(t.id, {
    title: t.session ? t.title : input.slice(0, 25),
    timezone: $<HTMLSelectElement>("timezone").value,
    messages: [
      ...t.messages,
      { id: crypto.randomUUID(), role: "user", text: input, local: true },
    ],
    optimistic: undefined,
    pending: { key: crypto.randomUUID(), body },
    status: "starting",
    error: undefined,
  });
  $<HTMLTextAreaElement>("message-input").value = "";
  await render();
  schedule(0);
}
async function entered() {
  await api("/me");
  $("login").hidden = true;
  $("app").hidden = false;
  const t = active ? await getThread(active) : null;
  if (t) await selectChat(active);
  else await newChat();
}
async function signIn(code: string) {
  $<HTMLButtonElement>("login-form").querySelector("button")!.disabled = true;
  try {
    await api("/login", { code });
    $<HTMLInputElement>("access-code").value = "";
    await entered();
  } catch (e) {
    loginVisible();
    $("login-error").textContent =
      e instanceof Error ? e.message : "连接失败，请重试";
  } finally {
    $("login-form").querySelector("button")!.disabled = false;
  }
}
$("login-form").addEventListener("submit", (e) => {
  e.preventDefault();
  signIn($<HTMLInputElement>("access-code").value.trim());
});
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  send().catch(() => toast("无法保存对话，请检查浏览器存储是否可用。"));
});
$("message-input").addEventListener("keydown", (e) => {
  const event = e as KeyboardEvent;
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
});
$("message-input").addEventListener("input", () => render());
$("new-chat").onclick = () => newChat();
$("new-chat-mobile").onclick = () => newChat();
$("history-select").onchange = () =>
  selectChat($<HTMLSelectElement>("history-select").value);
$("logout").onclick = async () => {
  await api("/logout", {});
  loginVisible();
};
$("timezone").addEventListener(
  "change",
  () =>
    active &&
    updateThread(active, { timezone: $<HTMLSelectElement>("timezone").value }),
);
$("trip-select").addEventListener("change", async () => {
  await updateThread(active, {
    tripId: $<HTMLSelectElement>("trip-select").value || null,
  });
  await render();
});
$("toggle-inspector").onclick = () => {
  $("inspector").classList.toggle("open");
  $("toggle-inspector").setAttribute(
    "aria-expanded",
    String($("inspector").classList.contains("open")),
  );
};
$("close-inspector").onclick = () => {
  $("inspector").classList.remove("open");
  $("toggle-inspector").setAttribute("aria-expanded", "false");
};
$("export-trip").onclick = async () => {
  const t = await getThread(active),
    trip = t.tripId ? await getTrip(t.tripId) : null;
  if (!trip) return;
  const { receipts, ...data } = trip,
    url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = (trip.tables.trips[0]?.tripName ?? "行程") + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const date = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
};
for (const [symbol, title, caption, prompt] of [
  [
    "⇄",
    "找一班合适的高铁",
    "杭州 → 黄山，上午出发",
    `帮我查${date(8)}杭州到黄山的高铁，1名成人，上午出发，二等座，最多2班。只比较，先不放入行程。`,
  ],
  [
    "⌂",
    "比较两家酒店",
    "上海，适合两人的周末",
    `${date(8)}入住、${date(10)}离店，上海人民广场附近，2名成人，1间房，每晚预算1000元以内。比较2家酒店，先不保存。`,
  ],
  [
    "✳",
    "安排一次完整旅行",
    "东京三天，轻松逛博物馆",
    `上海出发，${date(28)}到${date(30)}去东京，2名成人。安排往返航班、每晚1500元以内的1间酒店、博物馆、午晚餐和东京塔门票，节奏轻松。先给草案，不保存。`,
  ],
  [
    "▱",
    "试试保存本地行程",
    "创建一份空白旅行计划",
    `请帮我创建一个空的正式行程，名字叫杭州两日游，${date(8)}至${date(9)}，状态规划中。只保存主表，不查供给，其他四张表为空。`,
  ],
]) {
  const button = node("button", "preset");
  const text = node("span");
  text.append(node("strong", "", title), node("small", "", caption));
  button.append(node("span", "preset-symbol", symbol), text);
  button.onclick = () => {
    $<HTMLTextAreaElement>("message-input").value = prompt;
    $<HTMLTextAreaElement>("message-input").focus();
    render();
  };
  $("presets").append(button);
}
window.addEventListener("online", () => schedule(0));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) schedule(0);
});
const code = new URLSearchParams(location.hash.slice(1)).get("access");
if (location.hash) history.replaceState(null, "", location.pathname);
if (code) signIn(code);
else entered().catch(() => loginVisible());
