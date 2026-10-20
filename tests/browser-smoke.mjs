import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const htmlPath = resolve(process.cwd(), "index.html");
const html = readFileSync(htmlPath);
const server = createServer((request, response) => {
  const pathname = (request.url || "/").split("?")[0];
  if (pathname === "/favicon.ico") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (pathname !== "/") {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "content-length": html.length,
    "cache-control": "no-store"
  });
  response.end(html);
});

let browser;
const pageErrors = [];
try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const response = await page.goto(baseUrl + "#/lab/1", { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);
  await page.locator("#view .cl-hero").waitFor({ state: "visible", timeout: 15000 });
  assert.equal(await page.evaluate(() => document.documentElement.lang), "fa");
  assert.equal(await page.evaluate(() => document.documentElement.dir), "rtl");
  assert.equal(await page.evaluate(() => window.CCTVAcademyData.chapters.length), 14);
  assert.equal(await page.locator('input[name="chapterLabAnswer"]').count(), 4);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "chapter lab must not introduce horizontal overflow at 390px");

  const scenario = await page.evaluate(() => window.CCTVChapterLabs[0][0]);
  await page.locator(".cl-answer").nth(scenario.answer).click();
  await page.getByRole("button", { name: "بررسی پاسخ من" }).click();
  await page.locator(".cl-feedback.is-correct").waitFor({ state: "visible" });

  // Saved answer must survive a full reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".cl-feedback.is-correct").waitFor({ state: "visible", timeout: 10000 });

  await page.getByRole("button", { name: "نتیجه طبیعی بود" }).click();
  const passText = await page.locator(".cl-simulator-result").innerText();
  assert.ok(passText.includes(scenario.check), "pass feedback must reference the selected scenario's check");
  assert.ok(passText.includes(scenario.why), "pass feedback must reference the scenario's technical rationale");
  assert.ok(passText.includes(scenario.clue), "pass feedback must reference the next step");
  assert.ok(!passText.includes("ثبت فرضی آدرس‌دهی"), "unrelated generic network feedback must not appear");

  await page.getByRole("button", { name: "تمرین دوباره" }).click();
  await page.locator(".cl-simulator-empty").waitFor({ state: "visible" });
  assert.equal(await page.locator(".cl-feedback").count(), 0);
  assert.equal(await page.locator('input[name="chapterLabAnswer"]:checked').count(), 0);

  await page.getByRole("button", { name: "نشانه مشکل دیده شد" }).click();
  const failText = await page.locator(".cl-simulator-result").innerText();
  assert.notEqual(passText, failText, "pass and fail outcomes must produce different feedback");
  assert.ok(failText.includes(scenario.why));

  // Test the workshop iframe opens and closes on a mobile viewport.
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#menuBtn").click();
  await page.locator("[data-open-workshops]").click();
  await page.waitForFunction(() => document.querySelector("#wsOverlay")?.style.display === "flex");
  await page.frameLocator("#wsFrame").locator("#trouble").waitFor({ state: "visible", timeout: 15000 });
  await page.locator("#wsClose").click();
  await page.waitForFunction(() => document.querySelector("#wsOverlay")?.style.display === "none");

  // Essential content must remain usable when external font services are blocked.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  await page.goto(baseUrl + "#/lab/1", { waitUntil: "domcontentloaded" });
  await page.locator("#view .cl-hero").waitFor({ state: "visible", timeout: 10000 });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#view .cl-hero").waitFor({ state: "visible", timeout: 10000 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "chapter lab must not introduce horizontal overflow at 1280px");

  assert.deepEqual(pageErrors, [], `uncaught browser errors: ${pageErrors.join("; ")}`);
  console.log("Browser smoke checks passed.");
  console.log("Covered: mobile/desktop layout, RTL, chapter routing, quiz save/reload, scenario feedback, retry/reset, workshop iframe open/close and blocked external fonts.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
