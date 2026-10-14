// Talks to Playwright: lists tests without running them, and reads JSON run reports.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, isAbsolute, resolve } from "node:path";

function playwrightCli(cwd) {
  const require = createRequire(resolve(cwd, "package.json"));
  for (const id of ["@playwright/test/cli", "playwright/cli"]) {
    try {
      return require.resolve(id);
    } catch {
      // try the next one
    }
  }
  throw new Error("Could not find @playwright/test in this project. Run this from your Playwright project folder (npm i -D @playwright/test).");
}

const parseJson = (text, what) => {
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`${what} did not contain JSON output`);
  return JSON.parse(text.slice(start));
};

/** Runs `playwright test --list --reporter=json`: no tests run, no globalSetup, no webServer. */
export function listTests({ cwd, playwrightConfig, projects = [], grep, env = {} }) {
  const args = [playwrightCli(cwd), "test", "--list", "--reporter=json"];
  if (playwrightConfig) args.push("--config", playwrightConfig);
  for (const project of projects) args.push("--project", project);
  if (grep) args.push("--grep", grep);
  let stdout;
  try {
    stdout = execFileSync(process.execPath, args, {
      cwd,
      env: { ...process.env, ...env },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.stdout?.includes("{")) stdout = error.stdout;
    else throw new Error(`playwright test --list failed:\n${error.stderr || error.message}`);
  }
  return parseJson(stdout, "playwright test --list");
}

export const readJson = (file) => parseJson(readFileSync(file, "utf8"), file);

/** Flattens a Playwright JSON report into one entry per spec, with its describe path. */
export function flattenReport(report) {
  const rootDir = report.config?.rootDir ?? process.cwd();
  const specs = [];
  const walk = (suite, path) => {
    for (const spec of suite.specs ?? []) {
      specs.push({
        file: isAbsolute(spec.file) ? spec.file : resolve(rootDir, spec.file),
        line: spec.line,
        title: spec.title,
        tags: spec.tags ?? [],
        suitePath: path,
        tests: spec.tests ?? [],
      });
    }
    for (const child of suite.suites ?? []) {
      const isFileSuite = !child.line || child.title === child.file || child.title === basename(child.file ?? "");
      walk(child, isFileSuite ? path : [...path, child.title]);
    }
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return specs;
}

const resultKey = (file, line, title) => `${file}:${line}:${title}`;

/** Map of spec -> { status, duration, retries, projects } from a JSON report of a real run. */
export function readResults(report) {
  const map = new Map();
  for (const spec of flattenReport(report)) {
    const ran = spec.tests.filter((t) => (t.results ?? []).length);
    if (!ran.length) continue;
    const statuses = ran.map((t) => t.status);
    const status = statuses.includes("unexpected") ? "failed" : statuses.includes("flaky") ? "flaky" : statuses.every((s) => s === "skipped") ? "skipped" : "passed";
    const duration = ran.reduce((sum, t) => sum + (t.results.at(-1)?.duration ?? 0), 0);
    const retries = Math.max(0, ...ran.map((t) => t.results.length - 1));
    const error = ran.flatMap((t) => t.results.flatMap((r) => r.errors ?? (r.error ? [r.error] : []))).map((e) => e.message ?? "")[0];
    map.set(resultKey(spec.file, spec.line, spec.title), {
      status,
      duration,
      retries,
      error: error ? error.replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 3).join(" ").slice(0, 300) : undefined,
    });
  }
  return { get: (file, line, title) => map.get(resultKey(file, line, title)), size: map.size, startTime: report.stats?.startTime };
}
