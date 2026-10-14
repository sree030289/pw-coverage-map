// @ts-check
const { test, expect } = require("@playwright/test");

test.describe("Legacy JS suite", () => {
  test("unknown route returns 404", async ({ request }) => {
    await test.step("When I call a route that does not exist", async () => {
      const response = await request.get("/api/nope");
      expect(response.status()).toBe(404);
    });
  });
});
