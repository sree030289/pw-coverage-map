// Public API. The CLI is a thin wrapper around generate().
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULTS, defineConfig, loadConfig } from "./config.js";
import { buildReport, defaultClassify, detectSourceUrl } from "./model.js";
import { loadOpenApi } from "./openapi.js";
import { listTests, readJson } from "./playwright.js";
import { renderCsv } from "./render/csv.js";
import { renderHtml } from "./render/html.js";
import { renderMarkdown } from "./render/markdown.js";

export { buildReport, defaultClassify, defineConfig, loadConfig, renderCsv, renderHtml, renderMarkdown };
export { diffReports, renderDiffMarkdown } from "./diff.js";
export { runChecks, stableView } from "./check.js";

/** Builds the report object (no files written). */
export async function createReport(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const config = { ...DEFAULTS, ...options, cwd };
  if (config.sourceUrl === undefined) config.sourceUrl = detectSourceUrl(cwd);
  const listReport = config.listFile ? readJson(resolve(cwd, config.listFile)) : listTests({ cwd, playwrightConfig: config.playwrightConfig, projects: config.projects, grep: config.grep, env: config.env });
  const runReport = config.results ? readJson(resolve(cwd, config.results)) : undefined;
  const openapi = config.openapi ? await loadOpenApi(resolve(cwd, config.openapi), config.openapiBasePath) : undefined;
  return buildReport({ listReport, runReport, openapi, config });
}

const WRITERS = {
  html: ["index.html", renderHtml],
  json: ["coverage.json", (r) => `${JSON.stringify(r, null, 2)}\n`],
  md: ["coverage.md", (r) => renderMarkdown(r)],
  csv: ["coverage.csv", renderCsv],
};

/** Writes the chosen formats into outDir and returns { report, files }. */
export function writeReport(report, { cwd = process.cwd(), outDir = DEFAULTS.outDir, formats = DEFAULTS.formats } = {}) {
  const dir = resolve(cwd, outDir);
  mkdirSync(dir, { recursive: true });
  const files = [];
  for (const format of formats) {
    const writer = WRITERS[format];
    if (!writer) throw new Error(`Unknown format "${format}". Use: ${Object.keys(WRITERS).join(", ")}`);
    const file = resolve(dir, writer[0]);
    writeFileSync(file, writer[1](report));
    files.push(file);
  }
  return files;
}

export async function generate(options = {}) {
  const report = await createReport(options);
  const files = writeReport(report, options);
  return { report, files };
}
