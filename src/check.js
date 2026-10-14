// Quality gates for CI. Each rule is off unless configured.
export function runChecks(report, rules = {}) {
  const failures = [];
  const ins = report.insights;
  if (rules.maxParked !== undefined && ins.parked.length > rules.maxParked) failures.push(`${ins.parked.length} parked tests (max ${rules.maxParked})`);
  if (rules.noAssertions && ins.noAssertions.length) failures.push(`${ins.noAssertions.length} test(s) without assertions: ${ins.noAssertions.join(", ")}`);
  if (rules.maxDuplicates !== undefined && ins.duplicates.length > rules.maxDuplicates) failures.push(`${ins.duplicates.length} overlapping test groups (max ${rules.maxDuplicates})`);
  if (rules.minApiCoverage !== undefined) {
    if (!ins.endpoints.spec) failures.push("minApiCoverage is set but no OpenAPI spec was given (--openapi)");
    else if (ins.endpoints.spec.percent < rules.minApiCoverage) failures.push(`API coverage ${ins.endpoints.spec.percent}% is below ${rules.minApiCoverage}%`);
  }
  if (rules.minTests !== undefined && report.totals.cases < rules.minTests) failures.push(`${report.totals.cases} tests (min ${rules.minTests})`);
  if (rules.noFailed && report.hasResults && ins.failed.length) failures.push(`${ins.failed.length} failed test(s) in the last run`);
  return failures;
}

/** The parts of a report that come from source code (not the time or the last run), for staleness checks. */
export function stableView(report) {
  return JSON.stringify(report.suites.map((s) => ({ ...s, cases: s.cases.map(({ result, ...c }) => c) })));
}
