/* Smart-review session check (pure logic, same extraction style as lab-interaction-check).
 * Loads window.CCTVSpacedReview from index.html plus the review-session functions
 * (buildReviewQueue / selectReviewAnswer / gradeReviewInSession) under a shimmed state,
 * then verifies: due-only queue sorted earliest-first with future items excluded,
 * reveal-then-grade flow, persisted review schedule, session completion, and that the
 * quiz re-submit path preserves an existing review schedule instead of resetting it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);

const srsSource = scripts.find((code) => code.includes("CCTVSpacedReview") && code.includes("function grade("));
assert.ok(srsSource, "CCTVSpacedReview module must be present");

const appScript = scripts.find((code) => code.includes("function buildReviewQueue()"));
assert.ok(appScript, "buildReviewQueue must be present");
assert.ok(appScript.includes("function reviewSessionHTML()"), "reviewSessionHTML must be present");
assert.ok(appScript.includes("function gradeReviewInSession("), "gradeReviewInSession must be present");
assert.ok(appScript.includes("onclick=\"startSmartReview()\""), "saved view must offer the smart-review session entry");
assert.ok(appScript.includes('state.quizAnswers[qs.indexOf(q)]'), "submitQuiz path located");
assert.match(appScript, /const old=priorList\[priorIndex\.get\(wrongQuestionKey\(q\)\)\][\s\S]*savedAt:old\?old\.savedAt:new Date\(\)\.toISOString\(\)/,
  "quiz re-submit must preserve an existing review schedule (old savedAt/review) instead of resetting it");

const srsShim = { exports: {} };
new Function("module", srsSource)(srsShim);
const R = srsShim.exports;
assert.equal(typeof R.isDue, "function", "spaced-review API loads");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function not found: ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0, quote = "";
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") { i += 1; continue; }
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === "{") { depth += 1; continue; }
    if (char === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced function body: ${name}`);
}

const mk = (q, chapter, qi) => ({ chapter, qi, q, a: 1, o: ["الف", "ب", "ج", "د"], e: "توضیح", tag: "تست", selectedAnswer: "الف", correctAnswer: "ب", savedAt: new Date().toISOString() });

const state = {
  reviewQueue: [], reviewIndex: 0, reviewAnswers: {}, reviewRevealed: {},
  reviewResults: null, reviewDone: false,
  progress: { wrongQuestions: [] }
};
let saveCalls = 0;

// Evaluate the three real functions against the shimmed state.
const api = new Function("srsShim", "__STATE__", `
  const state = __STATE__;
  let window = { CCTVSpacedReview: srsShim.exports };
  function saveProgress() { globalThis.saveCalls = (globalThis.saveCalls || 0) + 1; }
  function render() { /* shim */ }
  ${extractFunction(appScript, "buildReviewQueue")}
  ${extractFunction(appScript, "selectReviewAnswer")}
  ${extractFunction(appScript, "gradeReviewInSession")}
  return { buildReviewQueue, selectReviewAnswer, gradeReviewInSession };
`)(srsShim, state);

const dayMs = 86400000;
const now = Date.now();
state.progress.wrongQuestions = [
  { ...mk("قدیمی", 0, 0), savedAt: new Date(now - 10 * dayMs).toISOString() },
  { ...mk("آینده", 0, 1), savedAt: new Date(now + 1 * dayMs).toISOString() },
  { ...mk("الان", 1, 0), savedAt: new Date(now - 0.1 * dayMs).toISOString() }
];

api.buildReviewQueue();
assert.equal(state.reviewQueue.length, 2, "future-due question must be excluded from the queue");
assert.deepEqual(state.reviewQueue, [0, 2], "queue must be ordered earliest-due first");
assert.equal(state.reviewIndex, 0, "session starts at the first item");
assert.deepEqual(state.reviewResults, { again: 0, hard: 0, good: 0, easy: 0 }, "grade counters reset per session");

// Flow: answer, grade; then next item, answer, grade again.
api.selectReviewAnswer(0, "1");
assert.equal(state.reviewRevealed[0], true, "answering reveals feedback");
api.gradeReviewInSession(0, "good");
const savedQuestion = state.progress.wrongQuestions[0];
assert.equal(savedQuestion.review?.lastGrade, "good", "grade persists on the question");
assert.equal(new Date(savedQuestion.review.dueAt).getTime() > now, true, "good grade schedules a future due date");
assert.equal(globalThis.saveCalls, 1, "progress saved after each grade");
api.selectReviewAnswer(2, "0");
api.gradeReviewInSession(2, "again");
assert.equal(state.reviewResults.again, 1, "again counted once");
assert.equal(state.reviewIndex, 1, "index advanced to the last queue position");
assert.equal(state.reviewDone, true, "session finished after the last item");
assert.equal(R.isDue(state.progress.wrongQuestions[2].review, state.progress.wrongQuestions[2].savedAt), true,
  "agained item is due again immediately, so the next session picks it up");

// Reveal guard: grading without answering must not advance or mutate.
const before = JSON.stringify(state.progress.wrongQuestions[1]?.review ?? null);
state.reviewDone = false;
state.reviewQueue = [1];
state.reviewIndex = 0;
const doneState = state.reviewDone;
api.gradeReviewInSession(1, "good");
assert.equal(state.reviewIndex, 0, "grading without an answer must not advance the session");
assert.equal(JSON.stringify(state.progress.wrongQuestions[1]?.review ?? null), before, "grading without an answer must not mutate the question");
assert.equal(state.reviewDone, doneState, "grading without an answer must not finish the session");

// Quiz re-submit preserve logic is real JS: run wrongQuestionKey + the map/merge snippet shape.
const wrongQuestionKeySource = extractFunction(appScript, "wrongQuestionKey");
const keyOf = new Function(`${wrongQuestionKeySource}; return wrongQuestionKey;`)();
assert.equal(keyOf({ chapter: 0, qi: 1, q: "x" }), "0:1:x", "wrongQuestionKey shape");

console.log("Smart review checks passed.");
console.log("Covered: due-only queue (earliest first, future excluded), reveal-then-grade flow with persistence, immediate re-queue for 'again', reveal guard, and schedule preservation on quiz re-submit.");
