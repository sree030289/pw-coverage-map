// One row per test case, for spreadsheets and test-management imports.
const cell = (value) => {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function renderCsv(report) {
  const header = ["id", "suite", "test", "type", "tags", "projects", "steps", "assertions", "endpoints", "parked", "parked_reason", "status", "duration_ms", "file", "line"];
  const rows = report.suites.flatMap((suite) =>
    suite.cases.map((c) => [
      c.id,
      suite.path.join(" > "),
      c.title,
      c.type,
      c.tags.map((t) => `@${t}`).join(" "),
      c.projects.join(" "),
      c.steps.map((s) => s.title).join(" | "),
      c.assertions,
      c.calls.map((x) => `${x.method} ${x.path}`).join(" | "),
      c.parked ? c.parked.kind : "",
      c.parked?.reason ?? "",
      c.result?.status ?? "",
      c.result?.duration ?? "",
      c.file,
      c.line,
    ]),
  );
  return [header, ...rows].map((row) => row.map(cell).join(",")).join("\n") + "\n";
}
