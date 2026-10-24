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

  // Verify the new chapter infographic lab: all chapters, routing, animation controls and mobile width.
  await page.goto(baseUrl + "#/visual/1", { waitUntil: "domcontentloaded" });
  await page.locator("#view .visual-lab-page").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(await page.locator(".visual-chapter-btn").count(), 14, "all 14 chapters must have infographic navigation");
  assert.equal(await page.evaluate(() => window.CCTVVisualLabScenes.length), 14, "each chapter needs its own visual scene data");
  assert.equal(await page.locator("#visualDiagram").count(), 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    "visual lab must not introduce horizontal overflow at 390px");
  await page.locator(".visual-chapter-btn").nth(8).click();
  await page.getByRole("heading", { name: "عیب‌یابی حرفه‌ای CCTV" }).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).hash, "#/visual/9", "selected infographic should have a shareable chapter route");
  await page.locator('[data-visual-control="toggle"]').click();
  await page.getByRole("status").filter({ hasText: "انیمیشن متوقف است" }).waitFor({ state: "visible" });
  await page.locator('[data-visual-control="reset"]').click();
  await page.getByRole("status").filter({ hasText: "انیمیشن از ابتدا اجرا شد" }).waitFor({ state: "visible" });
  await page.locator('[data-visual-control="toggle"]').click();
  await page.getByRole("status").filter({ hasText: "انیمیشن در حال اجراست" }).waitFor({ state: "visible" });

  // Verify chapter-to-chapter controls and the mobile navigation entry.
  await page.locator('[data-visual-next]').click();
  await page.getByRole("heading", { name: "مفاهیم سخت و پرسش‌های تحلیلی" }).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).hash, "#/visual/11");
  await page.locator('[data-visual-prev]').click();
  await page.getByRole("heading", { name: "عیب‌یابی حرفه‌ای CCTV" }).waitFor({ state: "visible" });
  assert.equal(new URL(page.url()).hash, "#/visual/9");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator("#menuBtn").click();
  await page.locator('[data-view="visualLab"]').first().click();
  await page.locator("#view .visual-lab-page").waitFor({ state: "visible", timeout: 10000 });
  assert.equal(new URL(page.url()).hash, "#/visual/1", "visual lab must be reachable from the app menu");

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

  // Corrupt progress JSON must be backed up instead of silently discarded.
  await page.evaluate(() => localStorage.setItem("cctvAcademyProgressV1", "{broken-json"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#view .cl-hero").waitFor({ state: "visible", timeout: 10000 });
  const corruptBackup = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((item) => item.startsWith("cctvAcademyProgressV1.corruptBackup."));
    return key ? { key, value: localStorage.getItem(key) } : null;
  });
  assert.ok(corruptBackup, "corrupt progress must be preserved under a backup key");
  assert.equal(corruptBackup.value, "{broken-json");
  await page.locator('[role="status"]').filter({ hasText: "داده پیشرفت قابل خواندن نبود" }).waitFor({ state: "visible" });

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

  assert.deepEqual(pageErrors, [], `uncaught browser errors: ${pageErrors.join("; ")}`);
  console.log("Browser smoke checks passed.");
  console.log("Covered: mobile/desktop layout, RTL, chapter routing, quiz save/reload, scenario feedback, retry/reset, 14 animated infographic chapters, visual chapter routing and pause/reset controls, workshop iframe open/close and blocked external fonts.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
