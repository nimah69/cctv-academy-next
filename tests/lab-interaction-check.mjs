import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const dataSource = html + "\n" + readFileSync(resolve(process.cwd(), "assets/data/cctv-data.js"), "utf8");
function extractArrayAfter(marker) {
  const markerIndex = dataSource.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing data marker: ${marker}`);
  const start = dataSource.indexOf("[", markerIndex + marker.length - 1);
  assert.notEqual(start, -1);
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < dataSource.length; i += 1) {
    const char = dataSource[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) return JSON.parse(dataSource.slice(start, i + 1));
  }
  throw new Error(`unterminated array after ${marker}`);
}
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `function not found: ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0, quote = "", inString = false, escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") { inString = true; quote = char; continue; }
    if (char === "{") depth += 1;
    else if (char === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

const scriptBlocks = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const mainScript = scriptBlocks.find((code) => code.includes("function chapterLabHTML") && code.includes("function retryChapterLabScenario"));
assert.ok(mainScript, "chapter lab interaction script must exist");
assert.match(mainScript, /chapterLabSimulatorFeedback\(s,simResult\)/, "simulator renderer must use contextual feedback");

const feedbackSource = extractFunction(mainScript, "chapterLabSimulatorFeedback");
const feedback = new Function(`return (${feedbackSource});`)();
const decisionSource = extractFunction(mainScript, "chapterLabDecisionFeedback");
const decisionFeedback = new Function(`return (${decisionSource});`)();
const retrySource = extractFunction(mainScript, "retryChapterLabScenario");
const chapters = extractArrayAfter("window.CCTVAcademyData={chapters:");
const labs = extractArrayAfter("window.CCTVChapterLabs =");
assert.equal(labs.length, chapters.length);
let scenarioCount = 0;
for (let ci = 0; ci < labs.length; ci += 1) {
  for (const scenario of labs[ci]) {
    assert.equal(decisionFeedback(scenario, scenario.answer), scenario.why,
      `correct option must return the scenario's specific rationale: ${scenario.title}`);
    const wrongAnalyses = scenario.options
      .map((option, index) => ({ option, index, text: decisionFeedback(scenario, index) }))
      .filter((entry) => entry.index !== scenario.answer);
    assert.equal(new Set(wrongAnalyses.map((entry) => entry.text)).size, 3,
      `the three wrong-option analyses must be distinct: ${scenario.title}`);
    for (const entry of wrongAnalyses) {
      assert.ok(entry.text.includes(entry.option), `wrong-option analysis must name its option: ${scenario.title}`);
      assert.ok(entry.text.includes(scenario.clue), `wrong-option analysis must guide to the next step: ${scenario.title}`);
    }
    const pass = feedback(scenario, "pass");
    const fail = feedback(scenario, "fail");
    assert.notEqual(pass, fail, `pass/fail feedback must differ: ${scenario.title}`);
    for (const value of [scenario.check, scenario.why, scenario.clue]) {
      assert.ok(pass.includes(value), `pass feedback missing scenario detail in ${scenario.title}`);
      assert.ok(fail.includes(value), `fail feedback missing scenario detail in ${scenario.title}`);
    }
    assert.doesNotMatch(pass, /ثبت فرضی آدرس‌دهی/);
    assert.doesNotMatch(fail, /ثبت فرضی آدرس‌دهی/);
    scenarioCount += 1;
  }
}
assert.equal(scenarioCount, 70);

const state = {
  chapter: 0,
  labScenario: 0,
  labDraft: 2,
  progress: { labs: { "0:0": { answer: 2, checked: true }, "0:1": { answer: 1, checked: true } } },
  labSimulatorResults: { "0:0": "pass", "0:1": "fail" }
};
let saves = 0, renders = 0;
const retry = new Function("state", "saveProgress", "render", `return (${retrySource});`)(
  state, () => { saves += 1; }, () => { renders += 1; }
);
retry(0);
assert.equal(state.progress.labs["0:0"], undefined, "retry must clear current lab result");
assert.equal(state.labSimulatorResults["0:0"], undefined, "retry must clear current simulator outcome");
assert.ok(state.progress.labs["0:1"], "retry must preserve other lab progress");
assert.equal(state.labSimulatorResults["0:1"], "fail", "retry must preserve other simulator outcomes");
assert.equal(state.labScenario, 0);
assert.equal(state.labDraft, null);
assert.equal(saves, 1);
assert.equal(renders, 1);

console.log("Chapter-lab interaction checks passed.");
console.log(`Scenario feedback checked: ${scenarioCount}; wrong-option analyses checked: ${scenarioCount * 3}; retry clears both persisted answer and simulator result.`);
console.log("Scope: pure interaction logic only; actual mobile/browser presentation remains untested.");
