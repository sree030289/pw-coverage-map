import { test, expect } from "@playwright/test";

// Overlaps with "lists users" in users.spec.ts on purpose: the report flags it as a duplicate.
test("users endpoint is up", { tag: "@smoke" }, async ({ request }) => {
  const response = await request.get("/api/users");
  expect(response.status()).toBe(200);
  expect(Array.isArray(await response.json())).toBeTruthy();
});

// No assertion at all: the report flags it as a weak test.
test("ping the users endpoint", async ({ request }) => {
  await request.get("/api/users");
});
