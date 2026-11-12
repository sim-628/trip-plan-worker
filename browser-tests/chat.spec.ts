import { test, expect } from "@playwright/test";
const sid = "a".repeat(64);
const batch = {
  operationId: "browser-save-trip-001",
  tripId: null,
  expectedVersion: 0,
  changes: [
    {
      table: "trips",
      action: "insert",
      ref: "TRIP-1",
      data: {
        tripName: "杭州两日游",
        startDate: "2026-11-20",
        endDate: "2026-11-21",
        status: "规划中",
      },
    },
  ],
};
test("chat, confirmation, atomic local save, resume and narrow layout", async ({
  page,
}) => {
  let stage = 0,
    posts = 0,
    receipt: any;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/test/api/**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path.endsWith("/me") || path.endsWith("/login"))
      return route.fulfill({ json: { ok: true } });
    if (path.endsWith("/sessions") && req.method() === "POST") {
      posts++;
      return route.fulfill({
        status: 202,
        json: { id: sid, session_token: "fake-session", status: "starting" },
      });
    }
    if (path.endsWith("/results")) {
      const b = req.postDataJSON();
      if (b.call_id === "read-call") stage = 1;
      else {
        receipt = b;
        stage = 2;
      }
      return route.fulfill({ status: 202, json: { accepted: true } });
    }
    if (path.endsWith(sid))
      return route.fulfill({
        json: {
          status: stage === 2 ? "completed" : "requires_client_action",
          messages: [
            {
              id: "u",
              role: "user",
              text: "当前日期：2026-11-12；客户端支持：cards,local_trip_storage。\n保存杭州两日游",
            },
            {
              id: "a",
              role: "assistant",
              phase: stage === 2 ? "final_answer" : "commentary",
              text:
                stage === 2
                  ? "已保存到本地。<img src=x onerror=alert(1)>"
                  : "正在准备本地行程。",
            },
          ],
          dispatches: [],
          required_actions:
            stage === 0
              ? [
                  {
                    name: "read_local_trip",
                    call_id: "read-call",
                    arguments: { tripId: null },
                  },
                ]
              : stage === 1
                ? [
                    {
                      name: "apply_local_trip_changes",
                      call_id: "save-call",
                      arguments: batch,
                    },
                  ]
                : [],
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: { message: "unexpected route" } },
    });
  });
  await page.goto("/test/");
  await expect(
    page.getByRole("heading", { name: "想去哪里走走？" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local-backups/browser-test-results/welcome-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("发送旅行需求").fill("保存杭州两日游");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存到此浏览器", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#trip-summary")).toContainText("还没有保存");
  await page
    .getByRole("button", { name: "保存到此浏览器", exact: true })
    .click();
  await expect(page.locator("#trip-summary")).toContainText("杭州两日游");
  await expect(page.locator("#run-status")).toContainText("本轮已完成");
  expect(receipt.success).toBe(true);
  expect(receipt.output.status).toBe("applied");
  expect(receipt.output.version).toBe(1);
  expect(posts).toBe(1);
  await expect(page.locator(".user-bubble")).toHaveCount(1);
  await expect(page.locator("#messages")).not.toContainText("客户端支持");
  await expect(page.locator("#messages img")).toHaveCount(0);
  await page.reload();
  await expect(page.locator("#trip-summary")).toContainText("杭州两日游");
  await expect(page.locator("#messages")).toContainText("已保存到本地");
  expect(posts).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "开启新对话" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "行程与进度" }).click();
  await expect(page.locator("#trip-summary")).toBeVisible();
  await page.screenshot({
    path: ".local-backups/browser-test-results/local-trip-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("unknown send outcome retries the same idempotency key after reload", async ({
  page,
}) => {
  const keys: string[] = [];
  let fail = true;
  await page.route("**/test/api/**", async (route) => {
    const r = route.request(),
      p = new URL(r.url()).pathname;
    if (p.endsWith("/me")) return route.fulfill({ json: { ok: true } });
    if (p.endsWith("/sessions") && r.method() === "POST") {
      keys.push(r.headers()["idempotency-key"]);
      if (fail) {
        fail = false;
        return route.abort("connectionreset");
      }
      return route.fulfill({
        json: { id: sid, session_token: "fake-session", status: "starting" },
      });
    }
    return route.fulfill({
      json: {
        status: "completed",
        messages: [
          { role: "assistant", text: "连接成功", phase: "final_answer" },
        ],
        dispatches: [],
        required_actions: [],
      },
    });
  });
  await page.goto("/test/");
  await page.getByLabel("发送旅行需求").fill("连接测试");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator("#error-banner")).toContainText("发送暂未确认");
  await page.reload();
  await expect(page.locator("#messages")).toContainText("连接成功");
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1);
});

test("hotel cards show dates and both prices before acknowledging display", async ({
  page,
}) => {
  let shown = false;
  await page.route("**/test/api/**", async (route) => {
    const r = route.request(),
      p = new URL(r.url()).pathname;
    if (p.endsWith("/me")) return route.fulfill({ json: { ok: true } });
    if (p.endsWith("/sessions") && r.method() === "POST")
      return route.fulfill({
        json: { id: sid, session_token: "fake-session", status: "starting" },
      });
    if (p.endsWith("/results")) {
      expect(await page.locator(".result-card").innerText()).toContain(
        "入住总价：CNY 930",
      );
      shown = true;
      return route.fulfill({ status: 202, json: { accepted: true } });
    }
    return route.fulfill({
      json: {
        status: shown ? "completed" : "requires_client_action",
        messages: [{ id: "u", role: "user", text: "查酒店" }],
        dispatches: [{ name: "hotelSearchAgent", status: "completed" }],
        required_actions: shown
          ? []
          : [
              {
                name: "present_hotel_cards",
                call_id: "card-call",
                arguments: {
                  cards: [
                    {
                      id: "hotel-1",
                      name: "测试酒店",
                      check_in: "2026-11-20",
                      check_out: "2026-11-22",
                      guest_summary: "2位成人 · 1间房",
                      nightly_price: {
                        amount: 465,
                        currency: "CNY",
                        label: null,
                      },
                      total_price: {
                        amount: 930,
                        currency: "CNY",
                        label: null,
                      },
                      highlight: "近地铁",
                      price_note: "参考价，未预订",
                    },
                  ],
                },
              },
            ],
      },
    });
  });
  await page.goto("/test/");
  await page.getByLabel("发送旅行需求").fill("查酒店");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.locator(".result-card")).toContainText("每晚：CNY 465");
  await expect(page.locator(".result-card")).toContainText(
    "2026-11-20 — 2026-11-22",
  );
  await expect(page.locator("#run-status")).toContainText("本轮已完成");
  expect(shown).toBe(true);
});
