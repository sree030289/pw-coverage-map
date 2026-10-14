// Markdown summary: for MR/PR comments, job summaries ($GITHUB_STEP_SUMMARY) and wikis.
const esc = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const typeLabel = (t) => (t.length <= 3 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1));

export function renderMarkdown(report, { full = true } = {}) {
  const t = report.totals;
  const ins = report.insights;
  const byId = new Map(report.suites.flatMap((s) => s.cases).map((c) => [c.id, c]));
  const name = (id) => `${id} ${esc(byId.get(id)?.title)}`;
  const lines = [`## ${esc(report.title)}`, ""];

  const head = ["Tests", ...report.types.map(typeLabel), "Suites", "Steps", "Assertions", "Parked"];
  const values = [t.cases, ...report.types.map((ty) => t.byType[ty]), t.suites, t.steps, t.assertions, t.parked];
  if (report.hasResults) head.push("Passed", "Failed", "Flaky"), values.push(t.passed, t.failed, t.flaky);
  if (ins.endpoints.spec) head.push("API coverage"), values.push(`${ins.endpoints.spec.percent}% (${ins.endpoints.spec.covered}/${ins.endpoints.spec.total})`);
  lines.push(`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, `| ${values.join(" | ")} |`, "");

  const list = (title, ids, extra = () => "") => {
    if (!ids.length) return;
    lines.push(`### ${title} (${ids.length})`, "", ...ids.map((id) => `- ${name(id)}${extra(id)}`), "");
  };
  if (report.hasResults) {
    list("Failed", ins.failed);
    list("Flaky", ins.flaky);
  }
  if (ins.endpoints.spec) {
    const missing = ins.endpoints.spec.operations.filter((op) => !op.cases.length);
    if (missing.length) lines.push(`### Endpoints without tests (${missing.length})`, "", ...missing.map((op) => `- \`${op.method} ${op.path}\`${op.summary ? ` — ${esc(op.summary)}` : ""}`), "");
  }
  list("Tests without assertions", ins.noAssertions);
  if (ins.duplicates.length) {
    lines.push(`### Possible over-coverage (${ins.duplicates.length})`, "");
    for (const g of ins.duplicates) lines.push(`- ${g.kind === "identical" ? "Identical checks" : `${Math.round(g.similarity * 100)}% similar`}: ${g.cases.map(name).join(" · ")}`);
    lines.push("");
  }
  list("Parked", ins.parked, (id) => {
    const p = byId.get(id).parked;
    return ` — \`${p.kind}\`${p.reason ? `: ${esc(p.reason)}` : ""}`;
  });

  if (full) {
    lines.push("### All tests", "");
    for (const suite of report.suites) {
      lines.push(`<details><summary><b>${suite.id}. ${esc(suite.path.join(" › "))}</b> — ${suite.cases.length} tests (${esc(suite.file)})</summary>`, "");
      for (const c of suite.cases) {
        const tags = c.tags.map((tg) => `\`@${tg}\``).join(" ");
        lines.push(`- **${c.id}** ${esc(c.title)} ${tags}${c.parked ? " _(parked)_" : ""}`);
        for (const s of c.steps) lines.push(`${"  ".repeat(s.depth + 1)}- ${esc(s.title)}`);
      }
      lines.push("", "</details>", "");
    }
  }
  return lines.join("\n");
}
