// Findings computed from the report: duplicates, tests without assertions, endpoint coverage, tag matrix.
import { pathMatches } from "./openapi.js";

const jaccard = (a, b) => {
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return shared / (a.size + b.size - shared);
};

/**
 * Tests from different source locations that check the same things.
 * Loop-generated tests share one source and are not compared with each other.
 */
export function findDuplicates(cases, threshold = 0.85) {
  const bySource = new Map();
  for (const c of cases) {
    const key = `${c.file}:${c.line}`;
    if (!bySource.has(key) && !c.parked) bySource.set(key, c);
  }
  const sources = [...bySource.values()]
    .map((c) => ({ c, set: new Set(c.signature) }))
    .filter((s) => s.set.size >= 2);

  const exact = new Map();
  for (const s of sources) {
    const key = [...s.set].sort().join("\n");
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key).push(s.c);
  }
  const groups = [...exact.values()].filter((g) => g.length > 1).map((g) => ({ kind: "identical", similarity: 1, cases: g.map((c) => c.id) }));
  const inExact = new Set(groups.flatMap((g) => g.cases));

  for (let i = 0; i < sources.length; i++) {
    for (let j = i + 1; j < sources.length; j++) {
      const a = sources[i];
      const b = sources[j];
      if (inExact.has(a.c.id) && inExact.has(b.c.id)) continue;
      if (Math.min(a.set.size, b.set.size) < 3) continue;
      const similarity = jaccard(a.set, b.set);
      if (similarity >= threshold && similarity < 1) groups.push({ kind: "similar", similarity: Math.round(similarity * 100) / 100, cases: [a.c.id, b.c.id] });
    }
  }
  return groups;
}

export function endpointCoverage(cases, operations) {
  const endpoints = new Map();
  for (const c of cases) {
    for (const call of c.calls) {
      const key = `${call.method} ${call.path}`;
      if (!endpoints.has(key)) endpoints.set(key, { kind: call.kind, method: call.method, path: call.path, cases: new Set(), statuses: new Set() });
      const entry = endpoints.get(key);
      entry.cases.add(c.id);
      if (call.status && !String(call.status).includes("$")) entry.statuses.add(String(call.status));
    }
  }
  const list = [...endpoints.values()]
    .map((e) => ({ ...e, cases: [...e.cases], statuses: [...e.statuses].sort() }))
    .sort((a, b) => b.cases.length - a.cases.length || a.path.localeCompare(b.path));

  let spec = null;
  if (operations) {
    const active = cases.filter((c) => !c.parked);
    const parked = cases.filter((c) => c.parked);
    const hitsFor = (op, list) => list.filter((c) => c.calls.some((call) => call.kind === "api" && call.method === op.method && pathMatches(op.path, call.path)));
    const ops = operations.map((op) => {
      const hits = hitsFor(op, active);
      const tested = new Set(
        hits.flatMap((c) => c.calls.filter((call) => call.method === op.method && pathMatches(op.path, call.path) && call.status && !String(call.status).includes("$")).map((call) => String(call.status))),
      );
      return {
        ...op,
        cases: hits.map((c) => c.id),
        parkedCases: hitsFor(op, parked).map((c) => c.id),
        testedStatuses: [...tested].sort(),
        untestedStatuses: (op.responses ?? []).filter((code) => !tested.has(code)),
      };
    });
    const covered = ops.filter((op) => op.cases.length).length;
    const api = list.filter((e) => e.kind === "api");
    const unknown = api.filter((e) => !operations.some((op) => op.method === e.method && pathMatches(op.path, e.path)));
    const documented = ops.reduce((n, op) => n + (op.responses?.length ?? 0), 0);
    const documentedTested = ops.reduce((n, op) => n + (op.responses ?? []).filter((code) => op.testedStatuses.includes(code)).length, 0);
    spec = {
      operations: ops,
      covered,
      total: ops.length,
      percent: ops.length ? Math.round((covered / ops.length) * 1000) / 10 : 0,
      statusCovered: documentedTested,
      statusTotal: documented,
      notInSpec: unknown.map((e) => `${e.method} ${e.path}`),
    };
  }
  return { api: list.filter((e) => e.kind === "api"), pages: list.filter((e) => e.kind === "page"), spec };
}

export function tagMatrix(cases, types) {
  const rows = new Map();
  for (const c of cases) {
    for (const tag of c.tags.length ? c.tags : ["(untagged)"]) {
      if (!rows.has(tag)) rows.set(tag, Object.fromEntries(types.map((t) => [t, 0])));
      rows.get(tag)[c.type] += 1;
    }
  }
  return [...rows.entries()]
    .map(([tag, counts]) => ({ tag, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => (a.tag === "(untagged)") - (b.tag === "(untagged)") || b.total - a.total || a.tag.localeCompare(b.tag));
}

export function buildInsights(cases, types, { operations, duplicateThreshold } = {}) {
  const duplicates = findDuplicates(cases, duplicateThreshold);
  const ran = cases.filter((c) => c.result);
  return {
    duplicates,
    noAssertions: cases.filter((c) => c.assertions === 0 && !c.parked).map((c) => c.id),
    parked: cases.filter((c) => c.parked).map((c) => c.id),
    endpoints: endpointCoverage(cases, operations),
    tags: tagMatrix(cases, types),
    failed: ran.filter((c) => c.result.status === "failed").map((c) => c.id),
    flaky: ran.filter((c) => c.result.status === "flaky").map((c) => c.id),
    slowest: ran.filter((c) => c.result.status !== "skipped").sort((a, b) => b.result.duration - a.result.duration).slice(0, 10).map((c) => c.id),
  };
}
