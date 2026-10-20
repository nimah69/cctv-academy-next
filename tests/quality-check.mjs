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

console.log("Static quality check passed.");
console.log(`File: index.html (${size.toLocaleString("en-US")} bytes)`);
console.log(`Inline scripts parsed: ${scripts.length}`);
console.log(`Static IDs checked: ${ids.length}; duplicates: 0`);
console.log(`Feature markers checked: ${requiredMarkers.length}`);
console.log("Scope: static checks only; browser behavior, calculations, security and offline mode are not certified.");
