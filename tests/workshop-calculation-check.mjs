import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const nestedMatch = html.match(/<script type="application\/json" id="wsSrc">([\s\S]*?)<\/script>/i);
assert.ok(nestedMatch, "embedded workshop document must exist");
const nestedHtml = JSON.parse(nestedMatch[1].trim());
const scripts = [...nestedHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
const core = scripts.find((code) =>
  code.includes("function solveLink(") &&
  code.includes("function calculateStorage(") &&
  code.includes("function calculateUps(") &&
  code.includes("function calculateCoverage(") &&
  code.includes("// assets/js/sim/graph.js")
);
assert.ok(core, "pure workshop calculation core must exist");

const graphMarker = core.indexOf("// assets/js/sim/graph.js");
const openingBrace = core.indexOf("{");
assert.ok(graphMarker > openingBrace, "calculation core boundary must be found");
const pureDefinitions = core.slice(openingBrace + 1, graphMarker);
const names = [
  "solveLink", "budgetCheck", "parseIPv4", "formatIPv4", "parseCIDR",
  "subnet", "sameSubnet", "validateGateway", "planVLSM", "calculateStorage",
  "recommendCable", "calculateUps", "calculateCoverage", "assessSecurity"
];
const api = new Function(pureDefinitions + `\nreturn {${names.join(",")}};`)();

const shortPoE = api.solveLink({ type: "at", pdW: 12, lengthM: 10, material: "cu", tempC: 20 });
assert.equal(shortPoE.status, "ok");
assert.ok(Math.abs(shortPoE.resistanceOhm - 0.938) < 1e-9);
assert.ok(Math.abs(shortPoE.pseW - (12 + shortPoE.lossW)) < 1e-9);
assert.ok(shortPoE.vPdV > 49 && shortPoE.vPdV < 50);

const copperLong = api.solveLink({ type: "at", pdW: 12, lengthM: 100, material: "cu", tempC: 20 });
const ccaLong = api.solveLink({ type: "at", pdW: 12, lengthM: 100, material: "cca", tempC: 20 });
assert.ok(Math.abs(ccaLong.resistanceOhm / copperLong.resistanceOhm - 1.575) < 1e-9,
  "CCA model must use the documented 1.575 planning factor");
const ccaNoteAt = nestedHtml.lastIndexOf("CCA_FACTOR");
assert.ok(ccaNoteAt > 0);
assert.match(nestedHtml.slice(Math.max(0, ccaNoteAt - 250), ccaNoteAt), /1\\.575/,
  "the UI explanation must match the calculation factor");

const longPoE = api.solveLink({ type: "at", pdW: 25, lengthM: 100, material: "cca", tempC: 50 });
assert.equal(longPoE.status, "fail");
assert.ok(longPoE.reasons.length > 0, "failed PoE link must explain the limiting conditions");

const budget = api.budgetCheck({ switchBudgetW: 120, marginPct: 20, allocationsW: [12, 12, 12, 12, 12, 12, 12, 12] });
assert.equal(budget.totalW, 96);
assert.equal(budget.usableW, 96);
assert.equal(budget.status, "ok");
assert.equal(api.budgetCheck({ switchBudgetW: 120, marginPct: 20, allocationsW: [15, 15, 15, 15, 15, 15, 15, 15] }).status, "marginal");

const subnet = api.subnet("192.168.1.20", 24);
assert.equal(subnet.network, "192.168.1.0");
assert.equal(subnet.broadcast, "192.168.1.255");
assert.equal(subnet.usableHosts, 254);
assert.equal(api.subnet("192.168.1.0", 31).usableHosts, 2);
assert.throws(() => api.subnet("192.168.1.01", 24), /IPv4/);
assert.throws(() => api.subnet("192.168.1.1", 33), /CIDR/);

const vlsm = api.planVLSM(
  [{ name: "cams", hosts: 50 }, { name: "nvr", hosts: 10 }],
  { address: "192.168.10.0", prefix: 24 }
);
assert.equal(vlsm[0].cidr, "192.168.10.0/26");
assert.equal(vlsm[1].cidr, "192.168.10.64/28");
assert.throws(() => api.planVLSM([{ name: "oversized", hosts: 500 }], { address: "192.168.10.0", prefix: 24 }), /فضای آدرس‌دهی/);

const storage = api.calculateStorage({
  cameras: 8, bitrateMbps: 4, days: 30, hoursPerDay: 24,
  raid: "raid5", diskCount: 4, diskTB: 8, hotSpare: 0,
  nvrMaxInputMbps: 500, uplinkMbps: 1000, playbackMbps: 20
});
assert.ok(Math.abs(storage.rawTB - 10.368) < 1e-9);
assert.ok(Math.abs(storage.withOverheadTB - 11.09376) < 1e-9);
assert.ok(Math.abs(storage.requiredTB - 12.203136) < 1e-9);
assert.ok(Math.abs(storage.usableTB - 21.84) < 1e-9);
assert.equal(storage.capacityStatus, "مناسب");
assert.throws(() => api.calculateStorage({ cameras: 0, bitrateMbps: 4, days: 30 }), /تعداد دوربین/);

const ups = api.calculateUps({
  loadW: 100, powerFactor: 0.8, inverterEfficiency: 0.85,
  batteryWh: 1000, depthOfDischarge: 0.8, ageFactor: 0.8
});
assert.equal(ups.requiredVA, 125);
assert.equal(ups.usableWh, 544);
assert.ok(Math.abs(ups.runtimeMinutes - 326.4) < 1e-9);
assert.throws(() => api.calculateUps({ loadW: 100, batteryWh: 1000, inverterEfficiency: 1.1 }), /ضریب/);

const coverage = api.calculateCoverage({
  sensorWidthMm: 5.37, sensorHeightMm: 3.02, focalLengthMm: 4,
  distanceM: 10, horizontalPixels: 1920, verticalPixels: 1080,
  sceneWidthM: 20, sceneHeightM: 10, overlapPercent: 20
});
assert.ok(Math.abs(coverage.coveredWidthM - 13.425) < 1e-9);
assert.ok(Math.abs(coverage.pixelsPerMeter - 143.0167597765) < 1e-6);
assert.equal(coverage.dori, "بازشناسی (DORI قدیمی)");
assert.equal(coverage.current2025DensityLevel, 125);
assert.equal(coverage.sceneCoverage.fitsSingleCamera, false);
assert.throws(() => api.calculateCoverage({
  sensorWidthMm: 5.37, sensorHeightMm: 3.02, focalLengthMm: 4,
  distanceM: 10, horizontalPixels: 1920, verticalPixels: 1080, overlapPercent: 80
}), /هم‌پوشانی/);

console.log("Workshop calculation checks passed.");
console.log("Covered: PoE link feasibility, switch budget, subnet/VLSM, RAID storage, UPS runtime, lens/FOV/DORI and invalid inputs.");
console.log("Scope: isolated deterministic models only; real hardware, browser interactions and field conditions are not certified.");
