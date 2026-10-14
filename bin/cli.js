#!/usr/bin/env node
// pw-coverage-map: a coverage map of your Playwright suite, built from the source (no test run needed).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULTS, loadConfig } from "../src/config.js";
import { diffReports, renderDiffMarkdown } from "../src/diff.js";
import { runChecks, stableView } from "../src/check.js";
import { createReport, writeReport } from "../src/index.js";
import { renderMarkdown } from "../src/render/markdown.js";

const HELP = `pw-coverage-map — see what your Playwright tests cover, without running them

Usage
  npx pw-coverage-map [options]                 build the report (default: coverage-map/index.html + coverage.json)
  npx pw-coverage-map diff <before.json> [after.json] [--out file.md]
                                                Markdown summary of added/removed/changed tests (for MR/PR comments)

Options
  -o, --out <dir>            output folder (default: coverage-map)
  -f, --format <list>        html,json,md,csv (default: html,json)
  -t, --title <text>         page title
  -c, --config <file>        config file (default: pw-coverage-map.config.{mjs,js,json} or "pwCoverageMap" in package.json)
      --playwright-config <file>   Playwright config to use (passed to playwright --config)
      --project <name>       only these Playwright projects (repeatable)
      --grep <regex>         only tests matching (passed to playwright --grep)
      --results <file>       Playwright JSON report from a real run: adds passed/failed/flaky and durations
      --openapi <file>       OpenAPI/Swagger spec (.json, or .yaml with the "yaml" package): shows untested endpoints
      --list-file <file>     use saved output of "playwright test --list --reporter=json" instead of running it
      --source-url <tpl>     link template, e.g. https://github.com/org/repo/blob/main/{file}#L{line} (auto-detected from git)
      --no-source-url        do not link to source files
      --summary <file>       also append a Markdown summary to this file (e.g. $GITHUB_STEP_SUMMARY)

CI checks (exit code 1 when a rule fails)
      --check                fail if the report in --out is out of date with the specs (commit-the-report workflows)
      --max-parked <n>       fail if more than n tests are skipped/fixme
      --fail-on-no-assertions  fail if any test has no assertions
      --max-duplicates <n>   fail if more than n overlapping test groups
      --min-api-coverage <pct> fail if OpenAPI coverage is below pct (needs --openapi)
      --fail-on-failed       fail if --results contains failed tests

  -q, --quiet                only print errors
  -h, --help                 show this help
  -v, --version              show the version
`;

const options = {
  out: { type: "string", short: "o" },
  format: { type: "string", short: "f" },
  title: { type: "string", short: "t" },
  config: { type: "string", short: "c" },
  "playwright-config": { type: "string" },
  project: { type: "string", multiple: true },
  grep: { type: "string" },
  results: { type: "string" },
  openapi: { type: "string" },
  "list-file": { type: "string" },
  "source-url": { type: "string" },
  "no-source-url": { type: "boolean" },
  summary: { type: "string" },
  check: { type: "boolean" },
  "max-parked": { type: "string" },
  "fail-on-no-assertions": { type: "boolean" },
  "max-duplicates": { type: "string" },
  "min-api-coverage": { type: "string" },
  "fail-on-failed": { type: "boolean" },
  quiet: { type: "boolean", short: "q" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

const num = (value, flag) => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`${flag} needs a number`);
  return n;
};

async function main() {
  const { values: args, positionals } = parseArgs({ options, allowPositionals: true });
  if (args.help) return console.log(HELP);
  if (args.version) {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return console.log(pkg.version);
  }
  const cwd = process.cwd();
  const log = (...m) => !args.quiet && console.log(...m);

  if (positionals[0] === "diff") {
    const [, beforeFile, afterFile] = positionals;
    if (!beforeFile) throw new Error("Usage: pw-coverage-map diff <before.json> [after.json]");
    const before = JSON.parse(readFileSync(resolve(cwd, beforeFile), "utf8"));
    let after;
    if (afterFile) after = JSON.parse(readFileSync(resolve(cwd, afterFile), "utf8"));
    else {
      const { config } = await loadConfig(cwd, args.config);
      after = await createReport({ ...config, ...cliOverrides(args), cwd });
    }
    const md = renderDiffMarkdown(diffReports(before, after));
    if (args.out) writeFileSync(resolve(cwd, args.out), md);
    else process.stdout.write(md);
    return;
  }
  if (positionals.length && positionals[0] !== "generate") throw new Error(`Unknown command "${positionals[0]}". Run with --help.`);

  const { config, file: configFile } = await loadConfig(cwd, args.config);
  if (configFile) log(`Using ${relative(cwd, configFile) || configFile}`);
  const merged = { ...DEFAULTS, ...config, ...cliOverrides(args), cwd };
  merged.check = { ...DEFAULTS.check, ...config.check, ...checkOverrides(args) };

  const report = await createReport(merged);
  for (const warning of report.warnings) log(`  warn: ${warning}`);

  let failures = runChecks(report, merged.check);
  if (args.check) {
    const existing = resolve(cwd, merged.outDir, "coverage.json");
    if (!existsSync(existing)) failures.push(`--check: ${relative(cwd, existing)} does not exist; generate and commit it first`);
    else if (stableView(JSON.parse(readFileSync(existing, "utf8"))) !== stableView(report)) {
      failures.push(`--check: ${relative(cwd, existing)} is out of date. Run "npx pw-coverage-map" and commit the result.`);
    }
  } else {
    const files = writeReport(report, merged);
    const t = report.totals;
    log(`pw-coverage-map: ${t.cases} tests, ${t.suites} suites, ${t.steps} steps, ${t.assertions} assertions${t.parked ? `, ${t.parked} parked` : ""}`);
    const ins = report.insights;
    const notes = [
      ins.endpoints.spec && `API coverage ${ins.endpoints.spec.percent}% (${ins.endpoints.spec.covered}/${ins.endpoints.spec.total})`,
      ins.noAssertions.length && `${ins.noAssertions.length} without assertions`,
      ins.duplicates.length && `${ins.duplicates.length} overlapping groups`,
      report.hasResults && `${t.passed} passed, ${t.failed} failed, ${t.flaky} flaky`,
    ].filter(Boolean);
    if (notes.length) log(`  ${notes.join(" · ")}`);
    for (const f of files) log(`  wrote ${relative(cwd, f)}`);
  }
  if (args.summary) writeFileSync(resolve(cwd, args.summary), `${renderMarkdown(report, { full: false })}\n`, { flag: "a" });

  if (failures.length) {
    console.error(`\npw-coverage-map checks failed:\n${failures.map((f) => `  ✗ ${f}`).join("\n")}`);
    process.exitCode = 1;
  }
}

function cliOverrides(args) {
  const o = {};
  if (args.out) o.outDir = args.out;
  if (args.format) o.formats = args.format.split(",").map((s) => s.trim()).filter(Boolean);
  if (args.title) o.title = args.title;
  if (args["playwright-config"]) o.playwrightConfig = args["playwright-config"];
  if (args.project) o.projects = args.project;
  if (args.grep) o.grep = args.grep;
  if (args.results) o.results = args.results;
  if (args.openapi) o.openapi = args.openapi;
  if (args["list-file"]) o.listFile = args["list-file"];
  if (args["source-url"]) o.sourceUrl = args["source-url"];
  if (args["no-source-url"]) o.sourceUrl = null;
  return o;
}

function checkOverrides(args) {
  const o = {};
  if (args["max-parked"] !== undefined) o.maxParked = num(args["max-parked"], "--max-parked");
  if (args["fail-on-no-assertions"]) o.noAssertions = true;
  if (args["max-duplicates"] !== undefined) o.maxDuplicates = num(args["max-duplicates"], "--max-duplicates");
  if (args["min-api-coverage"] !== undefined) o.minApiCoverage = num(args["min-api-coverage"], "--min-api-coverage");
  if (args["fail-on-failed"]) o.noFailed = true;
  return o;
}

main().catch((error) => {
  console.error(`pw-coverage-map: ${error.message}`);
  process.exitCode = 2;
});
