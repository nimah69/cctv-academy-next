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

  // Exercise the reset control in each top-level interactive workshop.
  const workshopFrame = page.frameLocator("#wsFrame");
  const workshopIds = await workshopFrame.locator("section.workshop").evaluateAll((nodes) => nodes.map((node) => node.id));
  assert.equal(workshopIds.length, 8, "all eight top-level workshop sections must be present");
  for (const id of workshopIds) {
    await workshopFrame.locator(`.tab[data-tab="${id}"]`).click();
    const section = workshopFrame.locator(`section.workshop#${id}`);
    const reset = section.locator("[data-workshop-reset]");
    assert.equal(await reset.count(), 1, `${id}: exactly one reset control is expected`);
    const control = section.locator('input[type="text"], input[type="number"], input[type="range"], select, textarea').first();
    if (await control.count()) {
      const original = await control.evaluate((el) => {
        if (el instanceof HTMLSelectElement) {
          const selected = [...el.options].find((option) => option.defaultSelected);
          return selected ? selected.value : (el.options[0]?.value ?? "");
        }
        return el.defaultValue ?? "";
      });
      await control.evaluate((el) => {
        if (el instanceof HTMLSelectElement) {
          if (el.options.length > 1) el.selectedIndex = (el.selectedIndex + 1) % el.options.length;
        } else if (el instanceof HTMLInputElement && (el.type === "number" || el.type === "range")) {
          const min = el.min === "" ? 0 : Number(el.min);
          const max = el.max === "" ? 999999 : Number(el.max);
          const current = Number(el.value || min);
          let next = current + 1;
          if (next > max) next = current - 1;
          if (next < min) next = min;
          el.value = String(next);
        } else {
          el.value = "__audit_reset_test__";
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await reset.click();
      const current = await control.evaluate((el) => el.value);
      assert.equal(current, original, `${id}: reset must restore the first control's default value`);
    } else {
      await reset.click();
    }
  }

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

  // Corrupt progress JSON must be backed up before the app's own unload handlers can rewrite it.
  const corruptContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1
  });
  await corruptContext.addInitScript(() => {
    localStorage.setItem("cctvAcademyProgressV1", "{broken-json");
  });
  const corruptPage = await corruptContext.newPage();
  corruptPage.on("pageerror", (error) => pageErrors.push(error.message));
  await corruptPage.goto(baseUrl + "#/lab/1", { waitUntil: "domcontentloaded" });
  await corruptPage.locator("#view .cl-hero").waitFor({ state: "visible", timeout: 10000 });
  const corruptBackup = await corruptPage.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("cctvAcademyProgressV1.corruptBackup."));
    return key ? { key, value: localStorage.getItem(key) } : null;
  });
  assert.ok(corruptBackup, "corrupt progress must be preserved under a backup key");
  assert.equal(corruptBackup.value, "{broken-json");
  await corruptPage.locator('[role="status"]').filter({ hasText: "داده پیشرفت قابل خواندن نبود" }).waitFor({ state: "visible" });
  await corruptContext.close();

  // Simulate quota/security failure: UI must not claim progress was persisted.
  const failingContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1
  });
  await failingContext.addInitScript(() => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "cctvAcademyProgressV1") {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      return originalSetItem.call(this, key, value);
    };
  });
  const failingPage = await failingContext.newPage();
  failingPage.on("pageerror", (error) => pageErrors.push(error.message));
  await failingPage.goto(baseUrl + "#/lab/1", { waitUntil: "domcontentloaded" });
  await failingPage.locator("#view .cl-hero").waitFor({ state: "visible", timeout: 10000 });
  const failingScenario = await failingPage.evaluate(() => window.CCTVChapterLabs[0][0]);
  await failingPage.locator(".cl-answer").nth(failingScenario.answer).click();
  await failingPage.getByRole("button", { name: "بررسی پاسخ من" }).click();
  await failingPage.locator(".cl-feedback.is-correct").waitFor({ state: "visible" });
  await failingPage.locator('[role="status"]').filter({ hasText: "ذخیره پیشرفت روی این دستگاه ناموفق بود" }).waitFor({ state: "visible" });
  const failingFeedback = await failingPage.locator(".cl-feedback.is-correct").innerText();
  assert.ok(failingFeedback.includes("ذخیره‌سازی روی دستگاه ناموفق بود"),
    "correct answer feedback must not falsely claim persistence when storage fails");
  assert.equal(await failingPage.evaluate(() => localStorage.getItem("cctvAcademyProgressV1")), null);
  await failingContext.close();

  // Imported/stored progress fields must be rendered as text, never executable HTML.
  const xssPayload = '<img src=x onerror="window.__academyXss=true">';
  const xssContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await xssContext.addInitScript((payload) => {
    if (location.protocol === "http:" || location.protocol === "https:") {
      window.__academyXss = false;
      localStorage.setItem("cctvAcademyProgressV1", JSON.stringify({
        done: [], scores: {}, labs: {}, comprehensive: null,
        wrongQuestions: [{
          chapter: 0, qi: 0, q: payload, tag: payload,
          selectedAnswer: payload, correctAnswer: payload,
          e: payload, savedAt: new Date().toISOString()
        }],
        studyPosition: null, microLessons: {}, microBookmarks: {}
      }));
    }
  }, xssPayload);
  const xssPage = await xssContext.newPage();
  xssPage.on("pageerror", (error) => pageErrors.push(error.message));
  await xssPage.goto(baseUrl + "#/saved", { waitUntil: "domcontentloaded" });
  await xssPage.locator(".review-card h3").waitFor({ state: "visible", timeout: 10000 });
  assert.ok((await xssPage.locator(".review-card h3").first().innerText()).includes(xssPayload),
    "untrusted question text should remain visible as escaped text");
  assert.equal(await xssPage.locator(".review-card img").count(), 0,
    "untrusted progress data must not create executable image elements");
  assert.equal(await xssPage.evaluate(() => window.__academyXss), false,
    "stored progress data must not execute an event-handler payload");
  await xssContext.close();

  assert.deepEqual(pageErrors, [], `uncaught browser errors: ${pageErrors.join("; ")}`);
  console.log("Browser smoke checks passed.");
  console.log("Covered: mobile/desktop layout, RTL, chapter routing, quiz save/reload, scenario feedback, retry/reset, workshop iframe open/close and blocked external fonts.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
