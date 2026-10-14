// Compares two coverage.json files: tests added, removed or changed. Output is Markdown for MR/PR comments.
const keyOf = (suite, c) => `${c.file}::${suite.path.join(" > ")}::${c.title}`;

function index(report) {
  const map = new Map();
  for (const suite of report.suites) for (const c of suite.cases) map.set(keyOf(suite, c), { ...c, suite: suite.path.join(" › ") });
  return map;
}

const stepSig = (c) => JSON.stringify([c.steps.map((s) => [s.title, s.details.map((d) => d.text)]), c.checks.map((d) => d.text)]);

export function diffReports(before, after) {
  const a = index(before);
  const b = index(after);
  const added = [...b.keys()].filter((k) => !a.has(k)).map((k) => b.get(k));
  const removed = [...a.keys()].filter((k) => !b.has(k)).map((k) => a.get(k));
  const changed = [];
  const parked = [];
  const unparked = [];
  for (const [k, now] of b) {
    const was = a.get(k);
    if (!was) continue;
    const reasons = [];
    if (stepSig(was) !== stepSig(now)) reasons.push(`steps/checks changed (${was.assertions} → ${now.assertions} assertions)`);
    if (was.tags.join() !== now.tags.join()) reasons.push("tags changed");
    if (reasons.length) changed.push({ ...now, reasons });
    if (!was.parked && now.parked) parked.push(now);
    if (was.parked && !now.parked) unparked.push(now);
  }
  const delta = (field) => (after.totals[field] ?? 0) - (before.totals[field] ?? 0);
  const coverage = (r) => r.insights?.endpoints?.spec?.percent;
  return {
    added,
    removed,
    changed,
    parked,
    unparked,
    totals: { cases: delta("cases"), assertions: delta("assertions"), parked: delta("parked") },
    apiCoverage: coverage(before) !== undefined && coverage(after) !== undefined ? { before: coverage(before), after: coverage(after) } : null,
  };
}

const sign = (n) => (n > 0 ? `+${n}` : String(n));
const esc = (v) => String(v ?? "").replace(/\|/g, "\\|");

export function renderDiffMarkdown(diff, { title = "Test coverage changes" } = {}) {
  const lines = [`## ${title}`, ""];
  const nothing = !diff.added.length && !diff.removed.length && !diff.changed.length && !diff.parked.length && !diff.unparked.length;
  if (nothing) return `${lines.join("\n")}No test changes.\n`;
  lines.push("| Tests | Assertions | Parked |" + (diff.apiCoverage ? " API coverage |" : ""), "|---|---|---|" + (diff.apiCoverage ? "---|" : ""));
  lines.push(`| ${sign(diff.totals.cases)} | ${sign(diff.totals.assertions)} | ${sign(diff.totals.parked)} |` + (diff.apiCoverage ? ` ${diff.apiCoverage.before}% → ${diff.apiCoverage.after}% |` : ""), "");
  const section = (heading, list, extra = () => "") => {
    if (!list.length) return;
    lines.push(`### ${heading} (${list.length})`, "", ...list.map((c) => `- ${esc(c.suite)} › **${esc(c.title)}** \`${c.file}:${c.line}\`${extra(c)}`), "");
  };
  section("➕ Added", diff.added, (c) => (c.assertions === 0 ? " ⚠️ no assertions" : ""));
  section("➖ Removed", diff.removed);
  section("✏️ Changed", diff.changed, (c) => ` — ${c.reasons.join(", ")}`);
  section("⏸️ Newly parked", diff.parked, (c) => (c.parked.reason ? ` — ${esc(c.parked.reason)}` : ""));
  section("▶️ Un-parked", diff.unparked);
  return lines.join("\n");
}
