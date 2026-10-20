// End-to-end: runs the CLI on the example project (uses `playwright test --list`, no browsers needed).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const example = join(root, "example");
const cli = join(root, "bin/cli.js");
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: example, encoding: "utf8" });

const out = mkdtempSync(join(tmpdir(), "pwcm-out-"));
const listFile = join(out, "list.json");
writeFileSync(listFile, execFileSync(process.execPath, [join(root, "node_modules/@playwright/test/cli.js"), "test", "--list", "--reporter=json"], { cwd: example, encoding: "utf8" }));

test("builds html, json, md and csv for the example suite", () => {
  const res = run("--list-file", listFile, "--openapi", "openapi.json", "--out", out, "-f", "html,json,md,csv", "--no-source-url");
  assert.equal(res.status, 0, res.stderr);
  const report = JSON.parse(readFileSync(join(out, "coverage.json"), "utf8"));
  assert.equal(report.totals.cases, 20);
  assert.deepEqual(report.totals.byType, { api: 16, ui: 4 });
  assert.equal(report.totals.parked, 3);
  assert.deepEqual(report.warnings, []);

  const byTitle = Object.fromEntries(report.suites.flatMap((s) => s.cases).map((c) => [c.title, c]));
  assert.equal(byTitle["rejects an empty name"].steps[0].title, "When I create a user with an empty name");
  assert.equal(byTitle["accepts a name of exactly 50 characters"].steps[0].title, "When I post a name of 50 characters");

  // tests declared with a fixture-extended `testAPI` instead of `test`
  const viaFixture = byTitle["creates a user with the users fixture"];
  assert.deepEqual(viaFixture.steps.map((s) => s.title), ["When I create a user", "Then it gets an id"]);
  assert.equal(viaFixture.assertions, 2);
  assert.deepEqual(byTitle["reads a missing user"].parked, { kind: "skip", reason: "Parked until ids are stable" });

  const ins = report.insights;
  assert.deepEqual(ins.noAssertions.map((id) => byTitle["ping the users endpoint"].id === id), [true]);
  assert.equal(ins.duplicates.length, 1);
  assert.deepEqual(new Set(ins.duplicates[0].cases), new Set([byTitle["users endpoint is up"].id, byTitle["lists users"].id]));
  assert.equal(ins.endpoints.spec.covered, 4);
  assert.equal(ins.endpoints.spec.total, 7);
  const patch = ins.endpoints.spec.operations.find((op) => op.method === "PATCH");
  assert.deepEqual(patch.cases, []);
  assert.deepEqual(patch.parkedCases, [byTitle["updates a user's role"].id]);
  assert.deepEqual(ins.endpoints.pages.map((p) => p.path), ["/", "/about"]);

  const html = readFileSync(join(out, "index.html"), "utf8");
  assert.match(html, /<title>Playwright Test Coverage<\/title>/);
  assert.match(html, /id="case-1\.1"/);
  assert.match(readFileSync(join(out, "coverage.csv"), "utf8"), /^id,suite,test,type/);
  assert.match(readFileSync(join(out, "coverage.md"), "utf8"), /### Endpoints without tests \(3\)/);
});

test("--check passes when up to date and fails when stale", () => {
  assert.equal(run("--list-file", listFile, "--out", out, "--check", "--no-source-url").status, 0);
  const file = join(out, "coverage.json");
  const report = JSON.parse(readFileSync(file, "utf8"));
  report.suites[0].cases[0].title = "renamed";
  writeFileSync(file, JSON.stringify(report));
  const res = run("--list-file", listFile, "--out", out, "--check", "--no-source-url");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /out of date/);
});

test("quality gates fail the build", () => {
  const res = run("--list-file", listFile, "--out", out, "--openapi", "openapi.json", "--fail-on-no-assertions", "--min-api-coverage", "90", "--max-parked", "1", "-q");
  assert.equal(res.status, 1);
  assert.match(res.stderr, /without assertions/);
  assert.match(res.stderr, /API coverage 57\.1% is below 90%/);
  assert.match(res.stderr, /3 parked tests \(max 1\)/);
});

test("diff lists added, removed and changed tests", () => {
  run("--list-file", listFile, "--out", out, "--no-source-url", "-q");
  const after = JSON.parse(readFileSync(join(out, "coverage.json"), "utf8"));
  const before = structuredClone(after);
  before.suites[0].cases.push({ ...before.suites[0].cases[0], title: "old test" });
  const listsUsers = before.suites.flatMap((s) => s.cases).find((c) => c.title === "lists users");
  listsUsers.checks = [];
  const beforeFile = join(out, "before.json");
  writeFileSync(beforeFile, JSON.stringify(before));
  const res = run("diff", beforeFile, join(out, "coverage.json"));
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /### ➖ Removed \(1\)/);
  assert.match(res.stdout, /old test/);
  assert.match(res.stdout, /### ✏️ Changed \(1\)/);
});
