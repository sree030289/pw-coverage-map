// One self-contained HTML file (inline CSS + JS, no network) so it works from disk, CI artifacts and Pages.
const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const TYPE_COLORS = { api: "var(--api)", ui: "var(--ui)", other: "var(--other)", mixed: "var(--muted)" };
const EXTRA = ["#0d9488", "#c2410c", "#be185d", "#4d7c0f", "#0369a1"];
const typeLabel = (t) => (t.length <= 3 ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1));
const ms = (n) => (n >= 60000 ? `${(n / 60000).toFixed(1)}m` : n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${n}ms`);
const STATUS_LABEL = { passed: "Passed", failed: "Failed", flaky: "Flaky", skipped: "Skipped" };

export function renderHtml(report) {
  const cases = report.suites.flatMap((s) => s.cases);
  const byId = new Map(cases.map((c) => [c.id, c]));
  const typeColor = (t) => TYPE_COLORS[t] ?? EXTRA[[...t].reduce((n, ch) => n + ch.charCodeAt(0), 0) % EXTRA.length];
  const { insights } = report;
  const dupOf = new Map();
  for (const group of insights.duplicates) for (const id of group.cases) dupOf.set(id, [...(dupOf.get(id) ?? []), ...group.cases.filter((x) => x !== id)]);
  const noAssert = new Set(insights.noAssertions);
  const sourceLink = (file, line) =>
    report.sourceUrl ? `<a class="src" href="${esc(report.sourceUrl.replace("{file}", file).replace("{line}", line))}" target="_blank" rel="noopener">${esc(file)}:${line}</a>` : `<span class="src">${esc(file)}:${line}</span>`;
  const caseLink = (id) => {
    const c = byId.get(id);
    return c ? `<a class="clink" href="#case-${id}"><span class="cid">${id}</span>${esc(c.title)}</a>` : esc(id);
  };
  const methodPill = (m) => `<span class="method m-${esc(m.toLowerCase())}">${esc(m)}</span>`;
  const hasKeywords = cases.some((c) => c.steps.some((s) => /^(Given|When|Then|And|But)\b/.test(s.title)));

  // ---------------------------------------------------------------- tests tab
  const detailList = (details) =>
    details.length
      ? `<ul class="det">${details
          .map((d) => {
            const mark = { check: "✓", status: "↳", call: "→", page: "⇢" }[d.kind] ?? "·";
            return `<li class="${d.kind}"><span class="mark">${mark}</span><code>${esc(d.text)}</code></li>`;
          })
          .join("")}</ul>`
      : "";

  const stepItem = (step) => {
    const match = hasKeywords ? /^(Given|When|Then|And|But)\b\s*/.exec(step.title) : null;
    const keyword = hasKeywords ? (match ? `<span class="kw kw-${match[1].toLowerCase()}">${match[1]}</span>` : `<span class="kw kw-none"></span>`) : "";
    const title = match ? step.title.slice(match[0].length) : step.title;
    return `<li style="--depth:${step.depth}">${keyword}<div><div class="stext">${esc(title)}</div>${detailList(step.details)}</div></li>`;
  };

  const caseHtml = (c) => {
    const flags = [];
    if (c.parked) flags.push("parked");
    if (noAssert.has(c.id)) flags.push("noassert");
    if (dupOf.has(c.id)) flags.push("duplicate");
    const status = c.result?.status ?? (report.hasResults ? "notrun" : "");
    const search = [c.id, c.title, c.file, ...c.tags.map((t) => `@${t}`), ...c.projects, ...c.steps.flatMap((s) => [s.title, ...s.details.map((d) => d.text)]), ...c.checks.map((d) => d.text), ...c.calls.map((x) => `${x.method} ${x.path}`)]
      .join(" ")
      .toLowerCase();

    const checkCount = c.steps.reduce((n, s) => n + s.details.length, 0) + c.checks.length;
    let body;
    if (c.steps.length || c.checks.length) {
      const summary = [c.steps.length ? plural(c.steps.length, "step") : "", plural(c.assertions, "assertion")].filter(Boolean).join(" · ");
      const outside = c.checks.length ? `<div class="outside">${c.steps.length ? "Outside steps" : "Checks"}</div>${detailList(c.checks)}` : "";
      body = `<details${checkCount ? "" : " class=\"empty\""}><summary>${summary}</summary>${c.steps.length ? `<ol class="steplist">${c.steps.map(stepItem).join("")}</ol>` : ""}${outside}</details>`;
    } else {
      body = `<span class="none">No steps or checks found</span>`;
    }

    const pills = [];
    if (c.result) pills.push(`<span class="status s-${c.result.status}" title="${c.result.retries ? plural(c.result.retries, "retry") : ""}">${STATUS_LABEL[c.result.status]}${c.result.status !== "skipped" ? ` · ${ms(c.result.duration)}` : ""}</span>`);
    else if (report.hasResults) pills.push(`<span class="status s-notrun">Not run</span>`);
    if (noAssert.has(c.id)) pills.push(`<span class="flag f-noassert" title="This test has no expect() or status check">No assertions</span>`);
    if (dupOf.has(c.id)) pills.push(`<span class="flag f-dup" title="Checks the same things as another test">Overlaps ${[...new Set(dupOf.get(c.id))].map((id) => `<a href="#case-${id}">${id}</a>`).join(", ")}</span>`);

    const parked = c.parked ? `<div class="parked"><span class="badge parked-badge">${c.parked.kind === "fail" ? "Expected to fail" : "Parked"}</span> ${esc(c.parked.reason || `test.${c.parked.kind}`)}</div>` : "";
    const error = c.result?.status === "failed" && c.result.error ? `<div class="error">${esc(c.result.error)}</div>` : "";
    const tags = c.tags.map((t) => `<span class="tag">@${esc(t)}</span>`).join("");
    const projects = c.projects.length > 1 || (c.projects[0] && c.projects[0] !== c.type) ? c.projects.map((p) => `<span class="proj">${esc(p)}</span>`).join("") : "";

    return `<div class="case" id="case-${c.id}" data-type="${esc(c.type)}" data-status="${status}" data-flags="${flags.join(" ")}" data-search="${esc(search)}">
  <div class="cname"><span class="cid">${c.id}</span><div class="cmain">
    <div class="ctitle">${esc(c.title)}</div>
    ${pills.length ? `<div class="pills">${pills.join("")}</div>` : ""}${parked}${error}
    <div class="meta">${tags}${projects}${sourceLink(c.file, c.line)}</div>
  </div></div>
  <div class="steps">${body}</div>
</div>`;
  };

  const suitesHtml = report.suites
    .map((suite) => {
      const name = suite.path.at(-1);
      const parent = suite.path.slice(0, -1).join(" › ");
      return `<section class="suite" style="--tc:${typeColor(suite.type)}">
  <div class="sno">${suite.id}</div>
  <div class="sname">
    ${parent ? `<div class="parent">${esc(parent)}</div>` : ""}
    <div class="stitle">${esc(name)}</div>
    <div class="smeta"><span class="badge" style="background:${typeColor(suite.type)}">${esc(typeLabel(suite.type))}</span><span>${plural(suite.cases.length, "test")}</span></div>
    <div class="file">${esc(suite.file)}</div>
  </div>
  <div class="cases">
${suite.cases.map(caseHtml).join("\n")}
  </div>
</section>`;
    })
    .join("\n");

  // ---------------------------------------------------------------- insights tab
  const sections = [];
  const section = (id, title, count, intro, content, tone = "") =>
    sections.push(`<section class="panel ${tone}" id="${id}"><h2>${esc(title)}${count !== null ? ` <span class="count">${count}</span>` : ""}</h2>${intro ? `<p class="intro">${intro}</p>` : ""}${content}</section>`);
  const caseRows = (ids, extra = () => "") => (ids.length ? `<ul class="clist">${ids.map((id) => `<li>${caseLink(id)}${extra(id)}</li>`).join("")}</ul>` : `<p class="ok">Nothing found.</p>`);

  const { endpoints } = insights;
  if (endpoints.spec) {
    const { spec } = endpoints;
    const rows = [...spec.operations]
      .sort((a, b) => (a.cases.length > 0) - (b.cases.length > 0) || a.path.localeCompare(b.path))
      .map((op) => {
        const codes = [...new Set([...(op.responses ?? []), ...op.testedStatuses])].sort();
        const statusCells = codes.map((code) => `<span class="code ${op.testedStatuses.includes(code) ? "yes" : "no"}" title="${op.testedStatuses.includes(code) ? "Tested" : "Documented, not tested"}${op.responses?.includes(code) ? "" : " (not in spec)"}">${esc(code)}</span>`).join("");
        const tests = op.cases.length
          ? op.cases.map((id) => `<a href="#case-${id}" class="cid">${id}</a>`).join(" ")
          : op.parkedCases.length
            ? `<span class="missing">Only parked tests</span> ${op.parkedCases.map((id) => `<a href="#case-${id}" class="cid">${id}</a>`).join(" ")}`
            : '<span class="missing">Not tested</span>';
        return `<tr class="${op.cases.length ? "" : "gap"}"><td>${methodPill(op.method)}</td><td><code>${esc(op.path)}</code>${op.deprecated ? ' <span class="tag">deprecated</span>' : ""}<div class="muted">${esc(op.summary)}</div></td><td>${statusCells}</td><td>${tests}</td></tr>`;
      })
      .join("");
    const notInSpec = spec.notInSpec.length ? `<p class="intro">Called by tests but not in the spec: ${spec.notInSpec.map((e) => `<code>${esc(e)}</code>`).join(", ")}</p>` : "";
    section(
      "endpoints",
      "API endpoint coverage",
      `${spec.covered}/${spec.total}`,
      `${spec.percent}% of the operations in ${esc(report.openapi?.title || "the OpenAPI spec")} are called by at least one active test${spec.statusTotal ? `, and ${spec.statusCovered} of ${spec.statusTotal} documented response codes are asserted` : ""}. Green codes are tested, red ones are documented but never checked. Skipped and fixme tests do not count.`,
      `<div class="bar"><span style="width:${spec.percent}%"></span></div><div class="tablewrap"><table><thead><tr><th>Method</th><th>Path</th><th>Status codes</th><th>Tests</th></tr></thead><tbody>${rows}</tbody></table></div>${notInSpec}`,
      spec.percent < 100 ? "warn" : "",
    );
  } else if (endpoints.api.length) {
    const rows = endpoints.api.map((e) => `<tr><td>${methodPill(e.method)}</td><td><code>${esc(e.path)}</code></td><td>${e.statuses.map((s) => `<span class="tag">${esc(s)}</span>`).join("")}</td><td>${e.cases.map((id) => `<a href="#case-${id}" class="cid">${id}</a>`).join(" ")}</td></tr>`).join("");
    section("endpoints", "API endpoints called", endpoints.api.length, "Every HTTP call found in test code. Pass <code>--openapi spec.json</code> to see which endpoints have no tests.", `<div class="tablewrap"><table><thead><tr><th>Method</th><th>Path</th><th>Statuses</th><th>Tests</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }
  if (endpoints.pages.length) {
    const rows = endpoints.pages.map((e) => `<tr><td><code>${esc(e.path)}</code></td><td>${e.cases.map((id) => `<a href="#case-${id}" class="cid">${id}</a>`).join(" ")}</td></tr>`).join("");
    section("pages", "Pages visited", endpoints.pages.length, "Routes opened with <code>page.goto()</code>, including from <code>beforeEach</code> hooks.", `<div class="tablewrap"><table><thead><tr><th>Route</th><th>Tests</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  if (report.hasResults) {
    section("failed", "Failed in the last run", insights.failed.length, "", caseRows(insights.failed), insights.failed.length ? "bad" : "");
    section("flaky", "Flaky in the last run", insights.flaky.length, "Passed only after a retry.", caseRows(insights.flaky), insights.flaky.length ? "warn" : "");
    section("slowest", "Slowest tests", null, "", caseRows(insights.slowest, (id) => ` <span class="dur">${ms(byId.get(id).result.duration)}</span>`));
  }

  section(
    "duplicates",
    "Possible over-coverage",
    insights.duplicates.length,
    "Tests in different places that make the same checks and calls. Candidates to merge or turn into one data-driven test.",
    insights.duplicates.length
      ? insights.duplicates.map((g) => `<div class="group"><span class="badge ${g.kind === "identical" ? "dup-same" : "dup-sim"}">${g.kind === "identical" ? "Identical checks" : `${Math.round(g.similarity * 100)}% similar`}</span>${caseRows(g.cases)}</div>`).join("")
      : `<p class="ok">Nothing found.</p>`,
    insights.duplicates.length ? "warn" : "",
  );
  section("noassert", "Tests without assertions", insights.noAssertions.length, "No <code>expect()</code>, assertion helper or expected-status argument was found. These tests can pass without checking anything.", caseRows(insights.noAssertions), insights.noAssertions.length ? "bad" : "");
  section(
    "parked",
    "Parked tests",
    insights.parked.length,
    "<code>test.skip</code>, <code>test.fixme</code> and <code>test.fail</code>, with the reason given in code.",
    caseRows(insights.parked, (id) => {
      const p = byId.get(id).parked;
      return ` <span class="reason">${esc(p.kind)}${p.reason ? ` — ${esc(p.reason)}` : ""}</span>`;
    }),
  );
  const tagHead = report.types.map((t) => `<th>${esc(typeLabel(t))}</th>`).join("");
  const tagRows = insights.tags.map((r) => `<tr><td>${r.tag === "(untagged)" ? '<span class="muted">(untagged)</span>' : `<span class="tag">@${esc(r.tag)}</span>`}</td>${report.types.map((t) => `<td class="${r.counts[t] ? "" : "zero"}">${r.counts[t] || "–"}</td>`).join("")}<td><b>${r.total}</b></td></tr>`).join("");
  section("tags", "Tag coverage", insights.tags.length, "How many tests carry each tag, split by test type. Empty cells show where a tag has no tests of that type.", `<div class="tablewrap"><table class="matrix"><thead><tr><th>Tag</th>${tagHead}<th>Total</th></tr></thead><tbody>${tagRows}</tbody></table></div>`);

  const findings = insights.duplicates.length + insights.noAssertions.length + (report.hasResults ? insights.failed.length + insights.flaky.length : 0) + (endpoints.spec ? endpoints.spec.total - endpoints.spec.covered : 0);

  // ---------------------------------------------------------------- page
  const card = (label, value, color, hint = "") => `<div class="card" style="--c:${color}"${hint ? ` title="${esc(hint)}"` : ""}><div class="num">${value}</div><div class="lbl">${esc(label)}</div></div>`;
  const t = report.totals;
  const cards = [
    card("Test cases", t.cases, "var(--accent)"),
    ...report.types.map((type) => card(typeLabel(type), t.byType[type], typeColor(type))),
    card("Suites", t.suites, "#475467"),
    card("Steps", t.steps, "#16a34a"),
    card("Assertions", t.assertions, "#0891b2"),
    card("Parked", t.parked, "#d97706"),
  ];
  if (report.hasResults) cards.push(card("Passed", t.passed, "#16a34a"), card("Failed", t.failed, "#dc2626"), card("Flaky", t.flaky, "#d97706"));
  if (endpoints.spec) cards.push(card("API coverage", `${endpoints.spec.percent}%`, "var(--accent)", `${endpoints.spec.covered} of ${endpoints.spec.total} OpenAPI operations`));

  const typeButtons = report.types.length > 1 ? `<div class="seg" role="group" aria-label="Type"><button type="button" data-type="all" aria-pressed="true">All</button>${report.types.map((type) => `<button type="button" data-type="${esc(type)}" aria-pressed="false">${esc(typeLabel(type))}</button>`).join("")}</div>` : "";
  const statusSelect = report.hasResults ? `<select id="status" aria-label="Last run status"><option value="">Any status</option><option value="passed">Passed</option><option value="failed">Failed</option><option value="flaky">Flaky</option><option value="skipped">Skipped</option><option value="notrun">Not run</option></select>` : "";
  const generated = report.generatedAt.slice(0, 16).replace("T", " ");
  const runNote = report.hasResults && report.resultsFrom ? ` Results from the run at ${esc(String(report.resultsFrom).slice(0, 16).replace("T", " "))}.` : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="pw-coverage-map">
<title>${esc(report.title)}</title>
<style>
  :root {
    color-scheme: light;
    --bg: #e9ecf1; --card: #fff; --line: #dde1e8; --muted: #667085; --text: #1d2939; --soft: #f7f8fb; --chip: #eef0f4; --chip-text: #475467;
    --accent: #0f766e; --accent-soft: #dff1ee; --api: #2563eb; --ui: #b45309; --other: #4d7c0f; --input: #c3c9d4; --head: #dde6e4; --head-text: #1f3b38;
    --warn-bg: #fff7e0; --warn-text: #7a4b00; --bad-bg: #fdecec; --bad-text: #b42318; --good: #15803d;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --bg: #0f1420; --card: #171d2b; --line: #273042; --muted: #98a2b3; --text: #e4e7ec; --soft: #1c2335; --chip: #242c3e; --chip-text: #c0c7d4;
      --accent: #3fb8a8; --accent-soft: #15332f; --api: #5b8def; --ui: #f0a54a; --other: #8cc63f; --input: #3a4458; --head: #1d2b2e; --head-text: #cfe3df;
      --warn-bg: #3a2e12; --warn-text: #f5c86b; --bad-bg: #3b1a1a; --bad-text: #f59e9e; --good: #4ade80;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #0f1420; --card: #171d2b; --line: #273042; --muted: #98a2b3; --text: #e4e7ec; --soft: #1c2335; --chip: #242c3e; --chip-text: #c0c7d4;
    --accent: #3fb8a8; --accent-soft: #15332f; --api: #5b8def; --ui: #f0a54a; --other: #8cc63f; --input: #3a4458; --head: #1d2b2e; --head-text: #cfe3df;
    --warn-bg: #3a2e12; --warn-text: #f5c86b; --bad-bg: #3b1a1a; --bad-text: #f59e9e; --good: #4ade80;
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  a { color: var(--accent); }
  code { font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .banner { background: #134e4a; color: #fff; border-bottom: 3px solid #0f766e; }
  .banner .inner, .page { max-width: 1320px; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
  .banner .inner { padding-top: 24px; padding-bottom: 0; }
  .titlebar { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; }
  h1 { font-size: 26px; margin: 0 0 4px; letter-spacing: -.01em; }
  .sub { color: #c7dfdb; margin: 0; }
  #theme { background: rgba(255,255,255,.12); color: #fff; border: 1px solid rgba(255,255,255,.25); border-radius: 8px; padding: 6px 12px; font: inherit; cursor: pointer; flex: none; }
  .tabs { display: flex; gap: 4px; margin-top: 18px; }
  .tabs button { background: transparent; color: #c7dfdb; border: 0; border-radius: 8px 8px 0 0; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; }
  .tabs button[aria-selected=true] { background: var(--bg); color: var(--text); }
  .tabs .count { background: #f59e0b; color: #1d2939; border-radius: 999px; font-size: 11px; padding: 0 7px; margin-left: 6px; }
  .page { padding-top: 20px; padding-bottom: 64px; }
  .totals { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 18px; }
  .card { background: var(--card); border-radius: 10px; border-top: 4px solid var(--c); padding: 10px 18px 12px; min-width: 112px; box-shadow: 0 1px 2px rgba(16,24,40,.08); }
  .num { font-size: 26px; font-weight: 700; color: var(--c); line-height: 1.2; font-variant-numeric: tabular-nums; }
  .lbl { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  .controls { position: sticky; top: 0; z-index: 2; background: var(--bg); display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 0 12px; }
  .controls input[type=search] { flex: 1 1 260px; min-width: 200px; padding: 9px 12px; border: 1px solid var(--input); border-radius: 8px; font: inherit; background: var(--card); color: var(--text); }
  .controls input[type=search]:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }
  select { padding: 8px 10px; border: 1px solid var(--input); border-radius: 8px; font: inherit; background: var(--card); color: var(--text); }
  .seg { display: inline-flex; border: 1px solid var(--input); border-radius: 8px; overflow: hidden; background: var(--card); }
  .seg button { border: 0; background: transparent; color: var(--text); padding: 8px 14px; font: inherit; cursor: pointer; border-right: 1px solid var(--input); }
  .seg button:last-child { border-right: 0; }
  .seg button[aria-pressed=true] { background: var(--accent); color: #fff; }
  .btn { border: 1px solid var(--input); background: var(--card); color: var(--text); border-radius: 8px; padding: 8px 12px; font: inherit; cursor: pointer; }
  .btn:hover { border-color: var(--accent); color: var(--accent); }
  #showing { color: var(--muted); margin-left: auto; font-weight: 600; }
  .head, .suite { display: grid; grid-template-columns: 52px 290px minmax(0, 1fr); }
  .head { font-weight: 600; background: var(--head); color: var(--head-text); border-radius: 10px; margin-bottom: 12px; border: 1px solid var(--line); }
  .head > div { padding: 10px 12px; }
  .head .pair, .case { display: grid; grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); }
  .suite { background: var(--card); border-radius: 10px; margin-bottom: 14px; overflow: hidden; box-shadow: 0 1px 3px rgba(16,24,40,.1); border-left: 4px solid var(--tc); }
  .sno, .sname { background: color-mix(in srgb, var(--tc) 7%, var(--card)); }
  .sno { padding: 12px; color: var(--muted); font-weight: 600; }
  .sname { padding: 12px; border-right: 1px solid var(--line); }
  .parent { color: var(--muted); font-size: 12px; margin-bottom: 2px; }
  .stitle { font-weight: 700; }
  .smeta { display: flex; gap: 8px; align-items: center; margin-top: 6px; color: var(--muted); font-size: 12px; }
  .file { color: var(--muted); font-size: 11px; margin-top: 6px; word-break: break-all; }
  .badge { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 999px; padding: 1px 9px; color: #fff; }
  .parked-badge { background: #fde9b0; color: #7a4b00; }
  .case { border-bottom: 1px solid var(--line); scroll-margin-top: 70px; }
  .case:last-child { border-bottom: 0; }
  .case:hover { background: var(--soft); }
  .case.flash { animation: flash 1.6s ease-out; }
  @keyframes flash { from { background: var(--accent-soft); } to { background: transparent; } }
  .cname { display: flex; gap: 10px; padding: 10px 12px; min-width: 0; }
  .cmain { min-width: 0; }
  .cid { display: inline-block; color: var(--accent); background: var(--accent-soft); border-radius: 6px; font-size: 12px; font-weight: 600; min-width: 38px; height: 22px; padding: 0 6px; text-align: center; line-height: 22px; flex: none; text-decoration: none; }
  .ctitle { font-weight: 500; }
  .pills { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
  .status, .flag { font-size: 11px; font-weight: 600; border-radius: 5px; padding: 1px 7px; }
  .s-passed { background: #dcfce7; color: #166534; } .s-failed { background: #fee2e2; color: #991b1b; }
  .s-flaky { background: #fef3c7; color: #92400e; } .s-skipped, .s-notrun { background: var(--chip); color: var(--chip-text); }
  .f-noassert { background: var(--bad-bg); color: var(--bad-text); } .f-dup { background: var(--warn-bg); color: var(--warn-text); }
  .f-dup a { color: inherit; }
  .parked { color: var(--warn-text); background: var(--warn-bg); border-radius: 6px; font-size: 12px; margin-top: 6px; padding: 4px 8px; }
  .error { color: var(--bad-text); background: var(--bad-bg); border-radius: 6px; font: 12px/1.45 ui-monospace, Menlo, monospace; margin-top: 6px; padding: 4px 8px; word-break: break-word; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; margin-top: 5px; }
  .tag, .proj { display: inline-block; color: var(--chip-text); background: var(--chip); border-radius: 4px; font-size: 11px; padding: 0 6px; }
  .proj { border: 1px solid var(--line); background: transparent; }
  .src { color: var(--muted); font-size: 11px; text-decoration: none; word-break: break-all; }
  a.src:hover { color: var(--accent); text-decoration: underline; }
  .steps { padding: 10px 12px; border-left: 1px solid var(--line); min-width: 0; }
  summary { cursor: pointer; color: var(--accent); font-weight: 600; }
  .steplist { list-style: none; margin: 8px 0 0; padding: 0; }
  .steplist > li { display: flex; gap: 10px; margin: 0 0 10px calc(var(--depth) * 22px); }
  .kw { flex: none; width: 52px; height: 20px; border-radius: 5px; font-size: 11px; font-weight: 700; text-align: center; line-height: 20px; background: var(--chip); color: var(--chip-text); }
  .kw-given { background: #dff1ee; color: #115e59; } .kw-when { background: #dbeafe; color: #1d4ed8; } .kw-then { background: #dcfce7; color: #15803d; }
  .kw-none { background: transparent; }
  .stext { font-weight: 500; }
  .outside { color: var(--muted); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; margin-top: 8px; }
  .det { list-style: none; margin: 4px 0 0; padding: 0; }
  .det li { display: flex; gap: 6px; color: var(--muted); font-size: 12px; margin: 2px 0; }
  .det .mark { flex: none; width: 12px; }
  .det .check .mark { color: var(--good); } .det .status .mark, .det .call .mark { color: var(--api); } .det .page .mark { color: var(--ui); }
  .det code { word-break: break-word; }
  .none, .muted { color: var(--muted); }
  .panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap: 16px; align-items: start; }
  .panel { background: var(--card); border-radius: 10px; padding: 16px 18px; box-shadow: 0 1px 3px rgba(16,24,40,.1); border-top: 4px solid var(--line); min-width: 0; }
  .panel.warn { border-top-color: #f59e0b; } .panel.bad { border-top-color: #dc2626; }
  #endpoints, #tags { grid-column: 1 / -1; }
  .panel h2 { font-size: 16px; margin: 0 0 4px; }
  .panel .count { background: var(--chip); color: var(--chip-text); border-radius: 999px; font-size: 12px; padding: 1px 8px; margin-left: 4px; }
  .intro { color: var(--muted); margin: 0 0 10px; }
  .ok { color: var(--good); margin: 4px 0 0; }
  .clist { list-style: none; margin: 0; padding: 0; }
  .clist li { padding: 5px 0; border-bottom: 1px solid var(--line); }
  .clist li:last-child { border-bottom: 0; }
  .clink { color: var(--text); text-decoration: none; display: inline-flex; gap: 8px; align-items: baseline; }
  .clink:hover { color: var(--accent); }
  .reason, .dur { color: var(--muted); font-size: 12px; }
  .group { margin: 10px 0 14px; } .group .clist { margin-top: 6px; }
  .dup-same { background: #dc6803; } .dup-sim { background: #ca8a04; }
  .tablewrap { overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td .cid { margin: 0 2px 2px 0; }
  tr.gap td { background: var(--bad-bg); }
  .missing { color: var(--bad-text); font-weight: 600; }
  .matrix td:not(:first-child), .matrix th:not(:first-child) { text-align: center; font-variant-numeric: tabular-nums; }
  .matrix td.zero { color: var(--muted); }
  .code { display: inline-block; font: 600 11px/18px ui-monospace, Menlo, monospace; border-radius: 4px; padding: 0 5px; margin: 0 4px 2px 0; }
  .code.yes { background: #dcfce7; color: #166534; } .code.no { background: var(--bad-bg); color: var(--bad-text); text-decoration: line-through; }
  .method { display: inline-block; min-width: 58px; text-align: center; font: 700 11px/20px ui-monospace, Menlo, monospace; border-radius: 5px; color: #fff; background: #64748b; }
  .m-get { background: #2563eb; } .m-post { background: #16a34a; } .m-put { background: #c2410c; } .m-patch { background: #0d9488; } .m-delete { background: #dc2626; }
  .bar { height: 10px; background: var(--bad-bg); border-radius: 999px; overflow: hidden; margin: 4px 0 12px; }
  .bar span { display: block; height: 100%; background: var(--good); }
  .warnings { color: var(--muted); font-size: 12px; margin-top: 24px; }
  footer { color: var(--muted); font-size: 12px; margin-top: 28px; text-align: center; }
  @media (max-width: 860px) {
    .head { display: none; }
    .suite { grid-template-columns: 36px minmax(0, 1fr); }
    .cases { grid-column: 1 / -1; }
    .case { grid-template-columns: 1fr; }
    .steps { border-left: 0; padding-top: 0; }
    #showing { margin-left: 0; }
  }
  @media print {
    .controls, .tabs, #theme { display: none; }
    [role=tabpanel][hidden] { display: block !important; }
    details > *:not(summary) { display: block; }
    .suite, .panel { break-inside: avoid; box-shadow: none; }
  }
</style>
</head>
<body>
<div class="banner"><div class="inner">
  <div class="titlebar">
    <div>
      <h1>${esc(report.title)}</h1>
      <p class="sub">${plural(t.cases, "test")} in ${plural(t.files, "file")} · generated ${esc(generated)} UTC.${runNote}</p>
    </div>
    <button id="theme" type="button" aria-label="Switch colour theme">Theme: auto</button>
  </div>
  <div class="tabs" role="tablist">
    <button type="button" role="tab" id="tab-tests" aria-controls="tests" aria-selected="true">Tests</button>
    <button type="button" role="tab" id="tab-insights" aria-controls="insights" aria-selected="false">Insights${findings ? `<span class="count">${findings}</span>` : ""}</button>
  </div>
</div></div>
<div class="page">
  <div class="totals">${cards.join("")}</div>

  <div id="tests" role="tabpanel" aria-labelledby="tab-tests">
    <div class="controls">
      <input id="q" type="search" placeholder="Search tests, steps, checks, tags, endpoints" aria-label="Search">
      ${typeButtons}
      ${statusSelect}
      <select id="flag" aria-label="Show">
        <option value="">All tests</option>
        <option value="parked">Parked only</option>
        <option value="noassert">No assertions</option>
        <option value="duplicate">Overlapping</option>
      </select>
      <button class="btn" id="expand" type="button">Expand all</button>
      <button class="btn" id="collapse" type="button">Collapse all</button>
      <span id="showing"></span>
    </div>
    <div class="head"><div>#</div><div>Test suite</div><div class="pair"><div>Test case</div><div>Steps and checks</div></div></div>
    <main id="list">
${suitesHtml}
    </main>
  </div>

  <div id="insights" role="tabpanel" aria-labelledby="tab-insights" hidden>
    <div class="panels">
${sections.join("\n")}
    </div>
  </div>
  ${report.warnings.length ? `<details class="warnings"><summary>${plural(report.warnings.length, "warning")}</summary><ul>${report.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}
  <footer>Made with pw-coverage-map — built from your Playwright specs by static analysis${report.hasResults ? ", with results read from a Playwright JSON report" : "; no tests were run"}.</footer>
</div>
<script>
(() => {
  const $ = (s) => document.querySelector(s);
  const input = $("#q"), flag = $("#flag"), status = $("#status"), showing = $("#showing");
  const typeButtons = [...document.querySelectorAll(".seg button")];
  const suites = [...document.querySelectorAll(".suite")];
  const total = ${t.cases};
  let type = "all";

  function apply() {
    const terms = input.value.toLowerCase().split(/\\s+/).filter(Boolean);
    let shown = 0;
    for (const suite of suites) {
      let any = false;
      for (const item of suite.querySelectorAll(".case")) {
        const ok = (type === "all" || item.dataset.type === type)
          && (!flag.value || item.dataset.flags.split(" ").includes(flag.value))
          && (!status || !status.value || item.dataset.status === status.value)
          && terms.every((term) => item.dataset.search.includes(term));
        item.hidden = !ok;
        if (ok) { any = true; shown += 1; }
      }
      suite.hidden = !any;
    }
    showing.textContent = "Showing " + shown + " of " + total;
  }
  input.addEventListener("input", apply);
  flag.addEventListener("change", apply);
  if (status) status.addEventListener("change", apply);
  for (const button of typeButtons) {
    button.addEventListener("click", () => {
      type = button.dataset.type;
      typeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      apply();
    });
  }
  const setAll = (open) => document.querySelectorAll("#list details").forEach((d) => { d.open = open; });
  $("#expand").addEventListener("click", () => setAll(true));
  $("#collapse").addEventListener("click", () => setAll(false));

  const tabs = [...document.querySelectorAll("[role=tab]")];
  function showTab(id) {
    for (const tab of tabs) {
      const on = tab.getAttribute("aria-controls") === id;
      tab.setAttribute("aria-selected", String(on));
      document.getElementById(tab.getAttribute("aria-controls")).hidden = !on;
    }
  }
  tabs.forEach((tab) => tab.addEventListener("click", () => {
    showTab(tab.getAttribute("aria-controls"));
    history.replaceState(null, "", tab.getAttribute("aria-controls") === "insights" ? "#insights" : location.pathname + location.search);
  }));

  function openHash() {
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash === "insights") return showTab("insights");
    const target = hash && document.getElementById(hash);
    if (!target || !target.classList.contains("case")) return;
    showTab("tests");
    if (target.hidden) {
      input.value = ""; flag.value = ""; if (status) status.value = "";
      type = "all"; typeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.type === "all")));
      apply();
    }
    const details = target.querySelector("details");
    if (details) details.open = true;
    target.scrollIntoView({ block: "center" });
    target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash");
  }
  window.addEventListener("hashchange", openHash);
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#case-"]');
    if (link && link.getAttribute("href") === location.hash) { event.preventDefault(); openHash(); }
  });

  const themes = ["auto", "light", "dark"];
  const themeButton = $("#theme");
  let theme = "auto";
  try { theme = localStorage.getItem("pwcm-theme") || "auto"; } catch {}
  function setTheme(next) {
    theme = next;
    if (next === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    themeButton.textContent = "Theme: " + next;
    try { localStorage.setItem("pwcm-theme", next); } catch {}
  }
  themeButton.addEventListener("click", () => setTheme(themes[(themes.indexOf(theme) + 1) % themes.length]));
  setTheme(theme);

  apply();
  openHash();
})();
</script>
</body>
</html>
`;
}
