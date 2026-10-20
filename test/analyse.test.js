import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createAnalyser, normalisePath, resolvePlaceholders } from "../src/analyse.js";
import { pathMatches } from "../src/openapi.js";

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "pwcm-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

test("normalisePath turns URLs into endpoint templates", () => {
  assert.equal(normalisePath("/api/users/${user.id}?x=1"), "/api/users/{id}");
  assert.equal(normalisePath("${baseUrl}/v1/orders/42"), "/v1/orders/{id}");
  assert.equal(normalisePath("https://example.com/v1/items/"), "/v1/items");
  assert.equal(normalisePath("/v1/files/report-${name}.pdf"), "/v1/files/report-{param}.pdf");
  assert.equal(normalisePath("users"), null);
});

test("pathMatches compares OpenAPI paths with called paths", () => {
  assert.ok(pathMatches("/api/users/{id}", "/api/users/{id}"));
  assert.ok(pathMatches("/api/users/{userId}", "/api/users/{id}"));
  assert.ok(!pathMatches("/api/users/{id}", "/api/users"));
  assert.ok(!pathMatches("/api/users/{id}/avatar", "/api/users/{id}"));
});

test("collects steps, nesting, checks, calls and parked reasons", () => {
  const dir = project({
    "a.spec.ts": `
      import { test, expect } from "@playwright/test";
      test.describe("Orders", () => {
        test.beforeEach(async ({ page }) => { await page.goto("/orders"); });
        test("lists orders", async ({ page, request }) => {
          await test.step("Given an order", async () => {
            const res = await request.post("/api/orders", { data: {} });
            expect(res.status()).toBe(201);
            await test.step("And it is saved", async () => {
              await expect(page.getByText("Saved")).toBeVisible();
            });
          });
          expect.soft(1).not.toBe(2);
        });
        test("parked", async () => {
          test.fixme(true, "BUG-1 broken");
        });
        test.skip("declared skip", async () => {});
      });
    `,
  });
  const { tests } = createAnalyser()(join(dir, "a.spec.ts"));
  const [first, second, third] = [...tests.values()];
  assert.equal(first.titleTemplate, "lists orders");
  assert.deepEqual(first.fixtures, ["page", "request"]);
  assert.deepEqual(first.steps.map((s) => [s.title, s.depth]), [["Given an order", 0], ["And it is saved", 1]]);
  assert.equal(first.assertions, 3);
  assert.deepEqual(first.calls.map((c) => [c.method, c.path, c.status]), [["GOTO", "/orders", undefined], ["POST", "/api/orders", "201"]]);
  assert.deepEqual(first.checks.map((c) => c.text), ["1 not is 2"]);
  assert.deepEqual(second.parked, { kind: "fixme", reason: "BUG-1 broken" });
  assert.equal(third.parked.kind, "skip");
});

test("discovers API client methods through imports, including fixtures files", () => {
  const dir = project({
    "clients/orders.ts": `
      export class Orders {
        constructor(private request) {}
        async create(body, expectedStatus = 201) { return this.request.post("/v1/orders", { data: body }); }
        async remove(id: string, expectedStatus = 204) { return this.request.delete(\`/v1/orders/\${id}\`); }
      }`,
    "fixtures.ts": `import { test as base } from "@playwright/test"; import { Orders } from "./clients/orders"; export const test = base.extend({});`,
    "tests/u.spec.ts": `
      import { test } from "../fixtures";
      test("creates", async ({ orders }) => {
        const u = await orders.create({ name: "a" });
        await orders.create({ name: "" }, 400);
        await orders.remove(u.id);
      });`,
  });
  const [record] = createAnalyser()(join(dir, "tests/u.spec.ts")).tests.values();
  assert.equal(record.assertions, 3);
  assert.deepEqual(record.calls.map((c) => `${c.method} ${c.path} ${c.status}`), ["POST /v1/orders 201", "POST /v1/orders 400", "DELETE /v1/orders/{id} 204"]);
});

test("configured client methods override discovery", () => {
  const dir = project({ "c.spec.ts": `import { test } from "@playwright/test"; test("x", async ({ api }) => { await api.callThing({}, 418); });` });
  const analyse = createAnalyser({ clientMethods: { callThing: { statusArg: 1, endpoint: "POST /thing" } } });
  const [record] = analyse(join(dir, "c.spec.ts")).tests.values();
  assert.deepEqual(record.calls, [{ kind: "api", method: "POST", path: "/thing", status: "418", input: "{}" }]);
});

test("placeholders are filled from the real title without running code", () => {
  const record = {
    titleTemplate: "rejects ${reason}",
    steps: [{ title: "When I send ${reason} with ${MAX + 1} chars and ${process.exit(1)}", depth: 0, details: [] }],
    checks: [],
    calls: [],
  };
  const out = resolvePlaceholders(record, { MAX: "50" }, "rejects an empty name");
  assert.equal(out.steps[0].title, "When I send an empty name with 51 chars and ‹process.exit(1)›");
});

test("placeholders support comparisons, ternaries and templates", () => {
  const record = { titleTemplate: "${from} -> ${to} returns ${expected}", steps: [{ title: "Then the step is ${expected === 200 ? to : from} (code ${expected})", depth: 0, details: [] }], checks: [], calls: [{ kind: "api", method: "PATCH", path: "/x", status: "${expected}" }] };
  assert.equal(resolvePlaceholders(record, {}, "Pending -> Done returns 200").steps[0].title, "Then the step is Done (code 200)");
  const out = resolvePlaceholders(record, {}, "Pending -> Done returns 409");
  assert.equal(out.steps[0].title, "Then the step is Pending (code 409)");
  assert.equal(out.calls[0].status, "409");
});

test("finds the path in wrapper calls like api.post(host, path)", () => {
  const dir = project({ "w.spec.ts": `import { test } from "@playwright/test"; test("x", async ({ api }) => { await api.post("", "/v1/orders", {}); await api.get<User>(host, \`/v1/orders/\${id}\`); });` });
  const [record] = createAnalyser()(join(dir, "w.spec.ts")).tests.values();
  assert.deepEqual(record.calls.map((c) => `${c.method} ${c.path}`), ["POST /v1/orders", "GET /v1/orders/{id}"]);
});

test("reads the Playwright report even when the config prints logs with braces", async () => {
  const { parseReport } = await import("../src/playwright.js");
  const report = { config: { rootDir: "/x" }, suites: [{ title: "a.spec.ts", specs: [] }] };
  const noisy = `[dotenv@17.2.3] injecting env (2) from .env -- tip: suppress all logs with { quiet: true }\n{ env: 'qa' }\n${JSON.stringify(report, null, 2)}\n`;
  assert.deepEqual(parseReport(noisy, "test"), report);
  assert.throws(() => parseReport("{ not json }", "test"), /Could not read the JSON report/);
});

test("recognises custom test functions from test.extend()", () => {
  const dir = project({
    "x.spec.ts": `
      import { apiTest, uiTest } from "./fixtures";
      apiTest("by line", async ({ request }) => {
        await apiTest.step("a step", async () => {});
      });
      uiTest.describe("group", () => {
        uiTest("by usage", async ({ page }) => {
          await uiTest.step("another step", async () => {});
          uiTest.fixme(true, "later");
        });
      });`,
  });
  // apiTest is only known from the line Playwright reports; uiTest from its .describe/.step usage
  const { tests } = createAnalyser()(join(dir, "x.spec.ts"), [3]);
  const [first, second] = [...tests.values()];
  assert.deepEqual(first.steps.map((s) => s.title), ["a step"]);
  assert.deepEqual(second.steps.map((s) => s.title), ["another step"]);
  assert.deepEqual(second.parked, { kind: "fixme", reason: "later" });
});
