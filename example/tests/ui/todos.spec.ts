import { test, expect } from "@playwright/test";

test.describe("Todo page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("adds a todo", { tag: "@smoke" }, async ({ page }) => {
    await test.step("When I add a todo", async () => {
      await page.getByLabel("New todo").fill("Write tests");
      await page.getByRole("button", { name: "Add" }).click();
    });
    await test.step("Then it appears in the list", async () => {
      await expect(page.getByRole("listitem")).toHaveText(["Write tests"]);
    });
  });

  test("ignores an empty todo", async ({ page }) => {
    await test.step("When I add an empty todo", async () => {
      await page.getByRole("button", { name: "Add" }).click();
    });
    await test.step("Then the list stays empty", async () => {
      await expect(page.getByRole("listitem")).toHaveCount(0);
    });
  });

  test("marks a todo as done", async ({ page }) => {
    await test.step("Given a todo exists", async () => {
      await page.getByLabel("New todo").fill("Ship it");
      await page.getByRole("button", { name: "Add" }).click();
    });
    await test.step("When I click it", async () => {
      await page.getByRole("listitem").click();
    });
    await test.step("Then it is marked done", async () => {
      await expect(page.getByRole("listitem")).toHaveClass("done");
    });
  });
});

test("about page loads", async ({ page }) => {
  await page.goto("/about");
  await expect(page.getByRole("heading")).toHaveText("About");
});
