import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "index.html");
const html = readFileSync(file, "utf8");
const size = statSync(file).size;

assert.ok(html.length > 100_000, "index.html exists and is not unexpectedly empty");
assert.match(html, /<title>آکادمی شبکه و نظارت تصویری<\/title>/, "document title is present");
assert.match(html, /setAttribute\(["']lang["'],\s*["']fa["']\)/, "Persian language is configured");
assert.match(html, /setAttribute\(["']dir["'],\s*["']rtl["']\)/, "RTL direction is configured");

const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length > 0, "at least one inline script exists");

const syntaxErrors = [];
for (let i = 0; i < scripts.length; i += 1) {
  try {
    // Parse only. Never execute application scripts in this test.
    new Function(scripts[i][1]);
  } catch (error) {
    syntaxErrors.push(`script #${i + 1}: ${error.message}`);
  }
}
assert.deepEqual(syntaxErrors, [], `inline JavaScript syntax errors: ${syntaxErrors.join("; ")}`);

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]);
const seenIds = new Set();
const duplicateIds = new Set();
for (const id of ids) {
  if (seenIds.has(id)) duplicateIds.add(id);
  seenIds.add(id);
}
assert.deepEqual([...duplicateIds], [], "static HTML id attributes must be unique");

const requiredMarkers = [
  ["interactive workshops", /کارگاه‌های تعاملی/],
  ["PoE calculator/workshop", /بودجه توان PoE/],
  ["IPv4/Subnet learning tool", /IP و Subnet/],
  ["progress persistence", /cctvAcademyProgress/],
  ["workshop close control", /wsClose/],
  ["workshop open control", /data-open-workshops/],
];
for (const [name, pattern] of requiredMarkers) {
  assert.match(html, pattern, `expected existing feature marker: ${name}`);
}

function extractJsonArrayAfter(marker) {
  const markerIndex = html.indexOf(marker);
  assert.notEqual(markerIndex, -1, `data marker not found: ${marker}`);
  const start = html.indexOf("[", markerIndex + marker.length - 1);
  assert.notEqual(start, -1, `array not found after marker: ${marker}`);

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const char = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }
  throw new Error(`unterminated JSON array after marker: ${marker}`);
}

const chapters = extractJsonArrayAfter("window.CCTVAcademyData={chapters:");
assert.equal(chapters.length, 14, "the known course structure must contain 14 chapters");

const allQuestions = [];
for (const chapter of chapters) {
  assert.ok(chapter.id && chapter.title, "each chapter needs an id and title");
  assert.ok(Array.isArray(chapter.sections) && chapter.sections.length > 0, `${chapter.title}: sections are required`);
  assert.ok(Array.isArray(chapter.quiz) && chapter.quiz.length > 0, `${chapter.title}: quiz questions are required`);
  const expandedChapterIds = new Set(["physical-environment-security", "cctv-cybersecurity", "backup-disaster-recovery", "risk-management", "standards-frameworks", "technical-interview", "advanced-concepts"]);
  if (expandedChapterIds.has(chapter.id)) {
    assert.equal(chapter.quiz.length, 25, `${chapter.title}: expected 25 questions after content expansion`);
    assert.equal(chapter.quiz.filter((question) => question.kind === "تکمیلی").length, 18,
      `${chapter.title}: added questions must be marked as supplementary`);
  }

  for (const question of chapter.quiz) {
    assert.ok(typeof question.q === "string" && question.q.trim(), `${chapter.title}: question text is required`);
    assert.ok(Array.isArray(question.o) && question.o.length === 4, `${chapter.title}: each question must have four options`);
    assert.equal(new Set(question.o.map((option) => String(option).trim().toLocaleLowerCase())).size, 4,
      `${chapter.title}: options must not be duplicates for question: ${question.q}`);
    assert.ok(Number.isInteger(question.a) && question.a >= 0 && question.a < question.o.length,
      `${chapter.title}: answer index is out of range for question: ${question.q}`);
    assert.ok(typeof question.e === "string" && question.e.trim().length >= 25,
      `${chapter.title}: explanation is missing/too short for question: ${question.q}`);
    allQuestions.push({ chapter: chapter.title, question });
  }
}

const normalize = (value) => String(value ?? "").toLocaleLowerCase().replace(/[\s\u200c]+/g, " ").trim();
const questionSeen = new Set();
const duplicateQuestions = [];
for (const { chapter, question } of allQuestions) {
  const key = normalize(question.q);
  if (questionSeen.has(key)) duplicateQuestions.push(`${chapter}: ${question.q}`);
  questionSeen.add(key);
}
assert.deepEqual(duplicateQuestions, [], "exact duplicate quiz questions must be reviewed/removed");

const labGroups = extractJsonArrayAfter("window.CCTVChapterLabs =");
assert.equal(labGroups.length, chapters.length, "each chapter must have a practical-lab group");
const labTitles = new Set();
for (let i = 0; i < labGroups.length; i += 1) {
  const group = labGroups[i];
  assert.ok(Array.isArray(group) && group.length === 5, `${chapters[i].title}: expected five practical scenarios`);
  for (const lab of group) {
    assert.ok(typeof lab.title === "string" && lab.title.trim(), `${chapters[i].title}: each lab needs a title`);
    const key = normalize(lab.title);
    assert.ok(!labTitles.has(key), `duplicate lab title: ${lab.title}`);
    labTitles.add(key);
  }
}

console.log("Static quality check passed.");
console.log(`File: index.html (${size.toLocaleString("en-US")} bytes)`);
console.log(`Inline scripts parsed: ${scripts.length}`);
console.log(`Static IDs checked: ${ids.length}; duplicates: 0`);
console.log(`Chapters: ${chapters.length}; quiz questions structurally checked: ${allQuestions.length}`);
console.log(`Practical scenarios checked: ${labTitles.size}`);
console.log(`Feature markers checked: ${requiredMarkers.length}`);
console.log("Scope: static checks only; browser behavior, calculation accuracy, security and offline mode are not certified.");
