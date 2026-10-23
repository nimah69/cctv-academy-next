/* Data-flow / XSS check (same bar as browser-smoke.mjs).
 * Serves index.html locally, plants hostile strings where the app persists or
 * imports data (localStorage progress + JSON import), then renders every view
 * that echoes that data. No inline handler, injected element, or executed
 * payload is allowed anywhere.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const html = readFileSync(resolve(process.cwd(), "index.html"));
const assets = {
  "/assets/data/cctv-data.js": { file: "assets/data/cctv-data.js", type: "text/javascript" },
  "/sw.js": { file: "sw.js", type: "text/javascript" },
  "/manifest.json": { file: "manifest.json", type: "application/manifest+json" },
  "/fonts/vazirmatn.css": { file: "fonts/vazirmatn.css", type: "text/css" },
  "/fonts/vazirmatn-arabic-var.woff2": { file: "fonts/vazirmatn-arabic-var.woff2", type: "font/woff2" },
  "/fonts/vazirmatn-latin-var.woff2": { file: "fonts/vazirmatn-latin-var.woff2", type: "font/woff2" },
  "/icons/icon-192.png": { file: "icons/icon-192.png", type: "image/png" },
  "/icons/icon-512.png": { file: "icons/icon-512.png", type: "image/png" }
};
const server = createServer((request, response) => {
  const pathname = (request.url || "/").split("?")[0];
  if (pathname !== "/") {
    const asset = assets[pathname];
    if (asset) {
      response.writeHead(200, { "content-type": asset.type });
      response.end(readFileSync(resolve(process.cwd(), asset.file)));
      return;
    }
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(html);
});

const IMG_PAYLOAD = '<img src=x onerror="window.__xss=(window.__xss||[]);window.__xss.push(1)">';
const CALLBACK_PAYLOAD = '<script>window.__xssExec=window.__xssExec||[];window.__xssExec.push("script")</script>';
const SVG_PAYLOAD = '<svg onload="window.__xss=(window.__xss||[]);window.__xss.push(2)"></svg>';

let browser;
try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1
  });
  const hostileProgress = {
    done: [0],
    wrongQuestions: [{
      chapter: 0,
      qi: 0,
      q: IMG_PAYLOAD + "سؤال آلوده",
      tag: SVG_PAYLOAD + "برچسب",
      selectedAnswer: IMG_PAYLOAD,
      correctAnswer: CALLBACK_PAYLOAD,
      e: IMG_PAYLOAD + "توضیح",
      savedAt: "2026-10-01T00:00:00.000Z"
    }],
    comprehensive: { score: IMG_PAYLOAD, total: IMG_PAYLOAD, percent: IMG_PAYLOAD, at: IMG_PAYLOAD },
    studyPosition: { chapter: 0, micro: CALLBACK_PAYLOAD, view: "lesson" },
    microLessons: { micro: CALLBACK_PAYLOAD },
    microBookmarks: { micro: CALLBACK_PAYLOAD }
  };
  await context.addInitScript((hostile) => {
    window.localStorage.setItem("cctvAcademyProgressV1", JSON.stringify(hostile));
  }, hostileProgress);

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // هیچ منبعی از اینترنت از راه نرسد؛ تنها خرداد لوکال مجاز است.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());

  // 1) مسیر ذخیره‌شده: نمای «ذخیره‌ها» با wrongQuestions آلوده
  await page.goto(baseUrl + "#/saved", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  let result = await page.evaluate(() => ({
    xss: window.__xss || null,
    xssExec: window.__xssExec || null,
    injected: document.querySelectorAll("img[src=x],[onerror],[onload],svg[onload]").length
  }));
  assert.equal(result.xss, null, "onerror payload in wrongQuestions must not execute");
  assert.equal(result.xssExec, null, "script payload in progress data must not execute");
  assert.equal(result.injected, 0, "hostile progress data must not create live img/svg/script elements");
  assert.ok((await page.locator("body").innerText()).includes("<img src=x"), "hostile text should render as inert text, not markup");

  // بقیهٔ نماها با داده‌های آلودهٔ ذخیره‌شده
  for (const view of ["#/home", "#/lesson/1", "#/lab/1", "#/tools", "#/cards"]) {
    await page.goto(baseUrl + view, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    result = await page.evaluate(() => ({
      xss: window.__xss || null,
      xssExec: window.__xssExec || null,
      injected: document.querySelectorAll("img[src=x],[onerror],svg[onload]").length
    }));
    assert.equal(result.xss, null, `${view}: hostile stored data must not execute`);
    assert.equal(result.xssExec, null, `${view}: script payload must not execute`);
    assert.equal(result.injected, 0, `${view}: hostile stored data must not render live markup`);
  }

  // 2) مسیر درون‌ریزی JSON: فایل پیشرفت آلوده از طریق input[type=file]
  const importPayload = JSON.stringify({
    app: "CCTV-Network-Academy",
    formatVersion: 1,
    progress: hostileProgress,
    ux: { cards: { a: { title: IMG_PAYLOAD, text: CALLBACK_PAYLOAD } }, streak: { day: IMG_PAYLOAD } }
  });
  await page.goto(baseUrl + "#/saved", { waitUntil: "domcontentloaded" });
  let importDialogSeen = false;
  page.once("dialog", (dialog) => { importDialogSeen = true; dialog.dismiss().catch(() => {}); });
  await page.locator("#progressImportInput").setInputFiles({
    name: "hostile-progress.json",
    mimeType: "application/json",
    buffer: Buffer.from(importPayload)
  });
  await page.waitForTimeout(1200);
  const eval2 = await page.evaluate(() => ({
    xss: window.__xss || null,
    xssExec: window.__xssExec || null,
    injected: document.querySelectorAll("img[src=x],[onerror],[onload],svg[onload]").length
  }));
  assert.equal(eval2.xss, null, "imported hostile JSON must not execute payloads");
  assert.equal(eval2.xssExec, null, "script payload from imported JSON must not execute");
  assert.equal(eval2.injected, 0, "imported JSON must not create live img/svg/script elements");
  assert.ok(importDialogSeen, "import flow should surface its confirmation dialog");

  assert.deepEqual(pageErrors, [], `uncaught browser errors: ${pageErrors.join("; ")}`);
  console.log("XSS/data-flow checks passed.");
  console.log("Covered: hostile localStorage progress on home/lesson/lab/tools/cards/saved views and hostile JSON progress import (incl. ux payload); no live img/svg/script, escaped text stays inert.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
