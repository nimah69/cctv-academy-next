import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
const source = scripts.find((code) =>
  code.includes("function poe(") &&
  code.includes("function bandwidth(") &&
  code.includes("function storage(") &&
  code.includes("function link(") &&
  code.includes("function subnet(") &&
  code.includes("const api={poe,bandwidth,storage,link,ipv4ToNumber,ipv4ToText,subnet}")
);
assert.ok(source, "the shared calculation module must be present");

const moduleShim = { exports: {} };
const windowShim = {};
// Execute only the isolated pure calculation module, not the application UI.
new Function("module", "window", source)(moduleShim, windowShim);
const calc = moduleShim.exports;

assert.deepEqual(calc.poe(4, 8, 20), { base: 32, total: 38.4 });

const bandwidth = calc.bandwidth(4, 4, 25);
assert.equal(bandwidth.base, 16);
assert.equal(bandwidth.total, 20);
assert.equal(bandwidth.gigabits, 0.02);

const storage = calc.storage(4, 4, 30, 10, 24, 0);
assert.equal(storage.tb, 5.184);
assert.ok(Math.abs(storage.withHeadroom - 5.7024) < 1e-10);

const linkUnderLimit = calc.link(50, 100, 70);
assert.equal(linkUnderLimit.percent, 50);
assert.equal(linkUnderLimit.remaining, 50);
assert.equal(linkUnderLimit.status, "status-good");

const linkNearLimit = calc.link(60, 100, 70);
assert.equal(linkNearLimit.status, "status-warn");

const linkOverLimit = calc.link(80, 100, 70);
assert.equal(linkOverLimit.percent, 80);
assert.equal(linkOverLimit.remaining, 20);
assert.equal(linkOverLimit.status, "status-bad");

const subnet = calc.subnet("192.168.1.20", 24);
assert.equal(subnet.maskText, "255.255.255.0");
assert.equal(subnet.networkText, "192.168.1.0");
assert.equal(subnet.broadcastText, "192.168.1.255");
assert.equal(subnet.hostCount, 254);
assert.equal(subnet.firstText, "192.168.1.1");
assert.equal(subnet.lastText, "192.168.1.254");

const cidr31 = calc.subnet("192.168.1.0", 31);
assert.equal(cidr31.hostCount, 2);
assert.equal(cidr31.firstText, "192.168.1.0");
assert.equal(cidr31.lastText, "192.168.1.1");

const cidr32 = calc.subnet("192.168.1.5", 32);
assert.equal(cidr32.hostCount, 1);
assert.equal(cidr32.firstText, "192.168.1.5");
assert.equal(cidr32.lastText, "192.168.1.5");

assert.throws(() => calc.poe(0, 8, 10), /تعداد دوربین/);
assert.throws(() => calc.poe(2, -1, 10), /توان هر دوربین/);
assert.throws(() => calc.poe(1.5, 8, 10), /عدد صحیح/);
assert.throws(() => calc.bandwidth(2, 3, 101), /حاشیه/);
assert.throws(() => calc.storage(2, 3, 0, 10, 24, 0), /روز/);
assert.throws(() => calc.link(10, 100, 101), /حد طراحی/);
assert.throws(() => calc.subnet("", 24), /IPv4/);
assert.throws(() => calc.subnet("192.168.1.256", 24), /IPv4/);
assert.throws(() => calc.subnet("192.168.1.1", 33), /CIDR/);
assert.throws(() => calc.subnet("192.168.1.1", 24.5), /CIDR/);

console.log("Calculation checks passed.");
console.log("Covered: PoE, bandwidth, storage, link thresholds, IPv4/Subnet /24-/31-/32 and invalid inputs.");
console.log("Scope: deterministic unit tests for the shared calculation module; no hardware/real-network validation.");
