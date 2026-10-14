// Builds the report data: suites -> cases -> steps, plus totals and insights.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, relative, sep } from "node:path";
import { createAnalyser, resolvePlaceholders } from "./analyse.js";
import { buildInsights } from "./insights.js";
import { flattenReport, readResults } from "./playwright.js";

export const REPORT_VERSION = 1;

const UI_FIXTURES = /^(page|context|browser|browserName|mount)$|Page$/;
const toPosix = (p) => p.split(sep).join("/");

/** Default classifier: folder names first, then fixtures, then project name. */
export function defaultClassify({ file, projects, fixtures, calls }) {
  const parts = file.toLowerCase().split("/");
  if (parts.some((p) => /^(api|apis|rest|graphql|backend|service|services|contract)$/.test(p))) return "api";
  if (parts.some((p) => /^(ui|e2e|web|frontend|pages|visual|components?)$/.test(p))) return "ui";
  if (fixtures.some((f) => UI_FIXTURES.test(f)) || calls.some((c) => c.kind === "page")) return "ui";
  const project = projects.join(" ").toLowerCase();
  if (/\bapi\b/.test(project)) return "api";
  if (fixtures.includes("request") || calls.some((c) => c.kind === "api")) return "api";
  if (/chrom|firefox|webkit|safari|edge|mobile|ui|e2e/.test(project)) return "ui";
  return "other";
}

/** https link template to the file on GitHub/GitLab/Bitbucket, from the git remote. */
export function detectSourceUrl(cwd) {
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    let remote = git("config", "--get", "remote.origin.url");
    const root = git("rev-parse", "--show-toplevel");
    const ref = process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_REF_NAME || git("rev-parse", "--abbrev-ref", "HEAD");
    remote = remote.replace(/^git@([^:]+):/, "https://$1/").replace(/^ssh:\/\/git@([^/:]+)(:\d+)?\//, "https://$1/").replace(/\.git$/, "").replace(/\/\/[^@/]+@/, "//");
    if (!/^https?:\/\//.test(remote) || ref === "HEAD") return null;
    const prefix = toPosix(relative(root, cwd));
    const file = prefix ? `${prefix}/{file}` : "{file}";
    if (remote.includes("gitlab")) return `${remote}/-/blob/${ref}/${file}#L{line}`;
    if (remote.includes("bitbucket")) return `${remote}/src/${ref}/${file}#lines-{line}`;
    return `${remote}/blob/${ref}/${file}#L{line}`;
  } catch {
    return null;
  }
}

/**
 * @param {object} input
 * @param {object} input.listReport  JSON from `playwright test --list --reporter=json`
 * @param {object} [input.runReport] JSON report of a real run (adds pass/fail/duration)
 * @param {object} [input.openapi]   result of loadOpenApi()
 * @param {object} input.config      resolved options
 */
export function buildReport({ listReport, runReport, openapi, config }) {
  const cwd = config.cwd;
  const analyse = createAnalyser(config);
  const results = runReport ? readResults(runReport) : null;
  const classify = config.classify ?? defaultClassify;

  const suites = new Map();
  const warnings = [];
  for (const spec of flattenReport(listReport)) {
    const file = toPosix(relative(cwd, spec.file));
    let analysis = { tests: new Map(), constants: {} };
    if (existsSync(spec.file)) {
      try {
        analysis = analyse(spec.file);
      } catch (error) {
        warnings.push(`Could not parse ${file}: ${error.message}`);
      }
    }
    const record = analysis.tests.get(spec.line);
    if (!record) warnings.push(`No source found for "${spec.title}" (${file}:${spec.line})`);
    const resolved = record ? resolvePlaceholders(record, analysis.constants, spec.title) : { steps: [], checks: [], calls: [] };
    const projects = [...new Set(spec.tests.map((t) => t.projectName).filter(Boolean))];

    let parked = record?.parked ?? null;
    const annotation = spec.tests.flatMap((t) => t.annotations ?? []).find((a) => ["skip", "fixme", "fail"].includes(a.type));
    if (annotation && (!parked || !parked.reason)) parked = { kind: annotation.type, reason: annotation.description ?? parked?.reason ?? "" };

    const calls = resolved.calls;
    const fixtures = record?.fixtures ?? [];
    const type = classify({ file, title: spec.title, tags: spec.tags, projects, fixtures, calls, suitePath: spec.suitePath }) || "other";

    const suiteKey = `${file}::${spec.suitePath.join(" > ")}`;
    if (!suites.has(suiteKey)) suites.set(suiteKey, { file, path: spec.suitePath.length ? spec.suitePath : [basename(file)], cases: [] });

    const rawDetails = record ? [...record.steps.flatMap((s) => s.details), ...record.checks] : [];
    suites.get(suiteKey).cases.push({
      title: spec.title,
      file,
      line: spec.line,
      tags: spec.tags,
      projects,
      type,
      fixtures,
      steps: resolved.steps,
      checks: resolved.checks,
      calls: dedupeCalls(calls).map(({ input, ...call }) => call),
      assertions: record?.assertions ?? 0,
      parked,
      result: results?.get(spec.file, spec.line, spec.title) ?? null,
      // What the test sends and checks; tests with the same signature are reported as overlapping.
      signature: [...new Set([...rawDetails.filter((d) => d.kind === "check" || d.kind === "status").map((d) => d.text), ...(record?.calls ?? []).map((c) => `${c.method} ${c.path} ${c.input ?? ""}`), ...(record?.inputs ?? [])])],
    });
  }

  // Order suites by file then by first test line, number them 1..n and cases 1.1..n.m.
  const ordered = [...suites.values()].sort((a, b) => a.file.localeCompare(b.file) || a.cases[0].line - b.cases[0].line);
  ordered.forEach((suite, i) => {
    suite.id = String(i + 1);
    suite.cases.sort((a, b) => a.line - b.line);
    suite.cases.forEach((c, j) => (c.id = `${i + 1}.${j + 1}`));
    const types = [...new Set(suite.cases.map((c) => c.type))];
    suite.type = types.length === 1 ? types[0] : "mixed";
  });

  const cases = ordered.flatMap((s) => s.cases);
  const typeOrder = ["api", "ui"];
  const types = [...new Set(cases.map((c) => c.type))].sort((a, b) => {
    const ia = typeOrder.indexOf(a);
    const ib = typeOrder.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const insights = buildInsights(cases, types, { operations: openapi?.operations, duplicateThreshold: config.duplicateThreshold });

  const byStatus = (status) => cases.filter((c) => c.result?.status === status).length;
  const totals = {
    cases: cases.length,
    suites: ordered.length,
    files: new Set(cases.map((c) => c.file)).size,
    steps: cases.reduce((n, c) => n + c.steps.length, 0),
    assertions: cases.reduce((n, c) => n + c.assertions, 0),
    parked: insights.parked.length,
    byType: Object.fromEntries(types.map((t) => [t, cases.filter((c) => c.type === t).length])),
    ...(results ? { passed: byStatus("passed"), failed: byStatus("failed"), flaky: byStatus("flaky"), skipped: byStatus("skipped"), notRun: cases.filter((c) => !c.result).length } : {}),
  };

  return {
    version: REPORT_VERSION,
    tool: "pw-coverage-map",
    title: config.title,
    generatedAt: new Date().toISOString(),
    sourceUrl: config.sourceUrl ?? null,
    hasResults: Boolean(results),
    resultsFrom: results?.startTime ?? null,
    openapi: openapi ? { title: openapi.title, version: openapi.version } : null,
    types,
    totals,
    suites: ordered,
    insights,
    warnings,
  };
}

function dedupeCalls(calls) {
  const seen = new Map();
  for (const call of calls) {
    const key = `${call.method} ${call.path}`;
    if (!seen.has(key) || (call.status && !seen.get(key).status)) seen.set(key, call);
  }
  return [...seen.values()];
}

export const findCase = (report, id) => report.suites.flatMap((s) => s.cases).find((c) => c.id === id);
export const allCases = (report) => report.suites.flatMap((s) => s.cases);
