// Regenerates docs/*.png from the example report (uses installed Chrome: PW_CHANNEL=chrome).
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const url = pathToFileURL(resolve("example/coverage-map/index.html")).href;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 2 });
await page.goto(url);
await page.getByRole("button", { name: "Expand all" }).click();
await page.screenshot({ path: "docs/tests.png" });
await page.getByRole("tab", { name: /Insights/ }).click();
await page.screenshot({ path: "docs/insights.png" });
await page.emulateMedia({ colorScheme: "dark" });
await page.locator("#endpoints").screenshot({ path: "docs/endpoints-dark.png" });
await browser.close();
