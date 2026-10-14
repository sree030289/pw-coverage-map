// Static analysis of spec files with the TypeScript compiler API (works for .ts and .js).
// For every test(...) call it records: steps (with nesting), what each step checks,
// HTTP calls and page visits, parked reasons and the fixtures the test uses.
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import ts from "typescript";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "fetch"]);
const PARK_METHODS = new Set(["skip", "fixme", "fail"]);
const MATCHERS = {
  toBe: "is", toEqual: "equals", toStrictEqual: "equals", toContain: "contains", toContainEqual: "contains",
  toHaveLength: "has length", toMatchObject: "matches", toMatch: "matches", toBeTruthy: "is truthy",
  toBeFalsy: "is falsy", toBeDefined: "is defined", toBeUndefined: "is undefined", toBeNull: "is null",
  toBeGreaterThan: "is greater than", toBeGreaterThanOrEqual: "is at least",
  toBeLessThan: "is less than", toBeLessThanOrEqual: "is at most", toBeOK: "is OK",
};
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js"];

const short = (value, max = 140) => {
  const one = value.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
};

const scriptKind = (file) => {
  const ext = extname(file);
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  if (ext === ".jsx") return ts.ScriptKind.JSX;
  if ([".js", ".mjs", ".cjs"].includes(ext)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

function parse(file) {
  const source = readFileSync(file, "utf8");
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file));
}

const isFunction = (node) => node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));

/** Text of a string / template literal, keeping `${expr}` placeholders. */
function literalText(node, sf) {
  if (!node) return "";
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => `\${${s.expression.getText(sf)}}${s.literal.text}`).join("");
  }
  return node.getText(sf);
}

const isStringish = (node) => node && (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node));

/** "/api/users/${user.id}?x=1" -> "/api/users/{id}". Returns null when it does not look like a URL path. */
export function normalisePath(raw) {
  let path = raw.trim().replace(/^https?:\/\/[^/]+/, "");
  path = path.replace(/^\$\{[^}]+\}(?=\/)/, ""); // `${baseUrl}/v1/...`
  if (!path.startsWith("/")) return null;
  path = path.split(/[?#]/)[0];
  path = path
    .split("/")
    .map((segment) => {
      if (/^\$\{[^}]+\}$/.test(segment)) {
        const name = segment.slice(2, -1).split(/[.\s()[\]]/).filter(Boolean).pop() ?? "param";
        return `{${name.replace(/\W/g, "") || "param"}}`;
      }
      if (/^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment)) return "{id}";
      return segment.replace(/\$\{[^}]+\}/g, "{param}");
    })
    .join("/");
  return path.length > 1 ? path.replace(/\/$/, "") : path;
}

/** The `expect(...)` call at the root of `expect(x).not.toBe(y)`, or null. */
function expectRoot(node) {
  let base = node.expression.expression;
  let negated = false;
  while (ts.isPropertyAccessExpression(base)) {
    if (base.name.text === "not") negated = true;
    base = base.expression;
  }
  if (!ts.isCallExpression(base)) return null;
  const callee = base.expression;
  const isExpect =
    (ts.isIdentifier(callee) && callee.text === "expect") ||
    (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && callee.expression.text === "expect");
  return isExpect ? { call: base, negated, poll: ts.isPropertyAccessExpression(callee) && callee.name.text === "poll" } : null;
}

function matcherPhrase(name) {
  return MATCHERS[name] ?? name.replace(/^to/, "").replace(/([A-Z])/g, " $1").trim().toLowerCase().replace(/^be /, "is ").replace(/^have /, "has ");
}

export function createAnalyser(options = {}) {
  const testNames = new Set(options.testNames ?? ["test", "it"]);
  const configuredClients = options.clientMethods ?? {};
  const helperPattern = options.assertionHelpers ? new RegExp(options.assertionHelpers) : /^(expect|assert|verify)[A-Z]/;
  const followImports = options.followImports !== false;
  const fileCache = new Map();
  const clientCache = new Map();

  // ------------------------------------------------------------ client discovery
  // Finds methods/functions in imported helper files that take an expected status
  // (a parameter named like `expectedStatus` / `status`) and the HTTP call they make.
  function discoverClients(file, depth = 0, seen = new Set()) {
    if (clientCache.has(file)) return clientCache.get(file);
    if (seen.has(file) || depth > 3 || !existsSync(file)) return {};
    seen.add(file);
    const found = {};
    let sf;
    try {
      sf = parse(file);
    } catch {
      return found;
    }

    const imports = [];
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && ts.isStringLiteral(node.arguments[0] ?? {})) {
        imports.push(node.arguments[0].text);
      }

      let name;
      let fn;
      if ((ts.isMethodDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
        name = node.name.text;
        fn = node;
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isFunction(node.initializer)) {
        name = node.name.text;
        fn = node.initializer;
      } else if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name) && isFunction(node.initializer)) {
        name = node.name.text;
        fn = node.initializer;
      }
      if (name && fn?.body && depth > 0) {
        const index = fn.parameters.findIndex((p) => ts.isIdentifier(p.name) && /^(expected)?status(code)?$/i.test(p.name.text));
        let endpoint = null;
        const findCall = (n) => {
          if (endpoint) return;
          const call = httpCall(n, sf);
          if (call?.kind === "api") endpoint = `${call.method} ${call.path}`;
          else ts.forEachChild(n, findCall);
        };
        findCall(fn.body);
        if (index >= 0 || endpoint) {
          const param = fn.parameters[index];
          const def = param?.initializer && ts.isNumericLiteral(param.initializer) ? param.initializer.text : undefined;
          found[name] = { statusArg: index >= 0 ? index : undefined, defaultStatus: def, endpoint: endpoint ?? undefined };
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);

    if (followImports) {
      for (const spec of imports) {
        if (!spec.startsWith(".")) continue;
        const base = resolve(dirname(file), spec);
        const target = EXTENSIONS.map((ext) => base + ext).find((p) => existsSync(p) && !p.endsWith("/"));
        const targetBase = base.replace(/\.(js|mjs|cjs)$/, "");
        const tsTarget = target ?? EXTENSIONS.map((ext) => targetBase + ext).find((p) => existsSync(p));
        if (tsTarget) Object.assign(found, discoverClients(tsTarget, depth + 1, seen), found);
      }
    }
    if (depth === 0) clientCache.set(file, found);
    return found;
  }

  // ------------------------------------------------------------ HTTP calls
  function httpCall(node, sf) {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return null;
    const name = node.expression.name.text;
    const arg = node.arguments[0];
    if (name === "goto" && isStringish(arg)) {
      const path = normalisePath(literalText(arg, sf));
      return path ? { kind: "page", method: "GOTO", path } : null;
    }
    if (!HTTP_METHODS.has(name)) return null;
    // request.get("/x") and wrappers like api.post(host, "/x", options)
    const path = node.arguments.slice(0, 2).filter(isStringish).map((a) => normalisePath(literalText(a, sf))).find(Boolean);
    if (!path) return null;
    let method = name.toUpperCase();
    if (name === "fetch") {
      method = "GET";
      const opts = node.arguments[1];
      if (opts && ts.isObjectLiteralExpression(opts)) {
        const m = opts.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(sf) === "method");
        if (m && ts.isStringLiteralLike(m.initializer)) method = m.initializer.text.toUpperCase();
      }
    }
    return { kind: "api", method, path };
  }

  // ------------------------------------------------------------ spec analysis
  function analyse(file) {
    if (fileCache.has(file)) return fileCache.get(file);
    const sf = parse(file);
    const clients = { ...discoverClients(file), ...configuredClients };
    const constants = {};
    const tests = new Map();

    // Everything a block of test code checks or calls, in source order.
    const details = (body, record, target, depth) => {
      const walk = (node) => {
        if (ts.isCallExpression(node)) {
          const callee = node.expression;
          // test.step("title", fn)
          if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && testNames.has(callee.expression.text)) {
            const method = callee.name.text;
            if (method === "step") {
              const fn = node.arguments.find(isFunction);
              const step = { title: literalText(node.arguments[0], sf), depth, details: [] };
              record.steps.push(step);
              if (fn) details(fn.body, record, step.details, depth + 1);
              return;
            }
            if (PARK_METHODS.has(method) && !isFunction(node.arguments[1])) {
              const reasonNode = node.arguments.length >= 2 ? node.arguments[1] : isStringish(node.arguments[0]) ? node.arguments[0] : null;
              record.parked = { kind: method, reason: reasonNode ? literalText(reasonNode, sf) : "" };
            }
          }

          // expect(x).toBe(y)
          if (ts.isPropertyAccessExpression(callee) && callee.name.text.startsWith("to")) {
            const root = expectRoot(node);
            if (root) {
              const actual = root.call.arguments[0]?.getText(sf) ?? "";
              const expected = node.arguments.map((a) => a.getText(sf)).join(", ");
              const text = short(`${actual} ${root.negated ? "not " : ""}${matcherPhrase(callee.name.text)} ${expected}`);
              target.push({ kind: "check", text });
              record.assertions += 1;
              // expect(response.status()).toBe(201) -> the last HTTP call expected 201
              const expectedArg = node.arguments[0];
              if (/\.status\(\)$/.test(actual) && expectedArg && ts.isNumericLiteral(expectedArg) && ["toBe", "toEqual"].includes(callee.name.text) && !root.negated) {
                const last = [...record.calls].reverse().find((c) => c.kind === "api" && !c.status);
                if (last) last.status = expectedArg.text;
              }
            }
          }

          // expectUserCreated(...) style helpers
          if (ts.isIdentifier(callee) && helperPattern.test(callee.text)) {
            target.push({ kind: "check", text: short(node.getText(sf)) });
            record.assertions += 1;
          }

          // client.createUser(body, 201) and request.get("/path")
          if (ts.isPropertyAccessExpression(callee)) {
            const name = callee.name.text;
            const client = clients[name];
            const call = httpCall(node, sf);
            if (client) {
              let status = client.defaultStatus;
              if (client.statusArg !== undefined) {
                const arg = node.arguments[client.statusArg];
                if (arg) status = ts.isNumericLiteral(arg) ? arg.text : `\${${arg.getText(sf)}}`;
                record.assertions += 1;
              }
              const [method, path] = client.endpoint ? client.endpoint.split(" ") : [];
              const input = short(node.arguments.filter((_, i) => i !== client.statusArg).map((a) => a.getText(sf)).join(", "), 200);
              if (method) record.calls.push({ kind: "api", method, path, status, input });
              else record.inputs.push(`${name}(${input})`);
              const what = client.endpoint ? `${name} (${client.endpoint})` : name;
              target.push({ kind: "status", text: status ? `${what} expects HTTP ${status}` : what });
            } else if (call) {
              record.calls.push({ ...call, input: short(node.arguments.map((a) => a.getText(sf)).join(", "), 200) });
              target.push({ kind: call.kind === "page" ? "page" : "call", text: `${call.method === "GOTO" ? "open" : call.method} ${call.path}` });
            }
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(body);
    };

    // Walk describes, keeping beforeEach hooks so their calls count for every test inside.
    const visit = (node, hooks) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (ts.isNumericLiteral(node.initializer) || ts.isStringLiteralLike(node.initializer)) {
          constants[node.name.text] = node.initializer.text;
        }
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const root = ts.isIdentifier(callee) ? callee : ts.isPropertyAccessExpression(callee) ? callee.expression : null;
        const method = ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
        const rootIsTest = root && ts.isIdentifier(root) && testNames.has(root.text);
        const describeRoot = ts.isPropertyAccessExpression(callee) && (callee.name.text === "describe" || (ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === "describe"));

        if (describeRoot) {
          const fn = node.arguments.find(isFunction);
          if (fn) {
            const scoped = [...hooks];
            for (const statement of fn.body.statements ?? []) {
              const expr = ts.isExpressionStatement(statement) ? statement.expression : null;
              if (expr && ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "beforeEach") {
                const hookFn = expr.arguments.find(isFunction);
                if (hookFn) scoped.push(hookFn);
              }
            }
            ts.forEachChild(fn.body, (child) => visit(child, scoped));
            return;
          }
        }

        const isDeclaration = rootIsTest && (method === null || ["only", ...PARK_METHODS].includes(method)) && isStringish(node.arguments[0]) && node.arguments.some(isFunction);
        if (isDeclaration) {
          const fn = node.arguments.find(isFunction);
          const param = fn.parameters[0];
          const fixtures = param && ts.isObjectBindingPattern(param.name) ? param.name.elements.map((e) => (e.propertyName ?? e.name).getText(sf)) : [];
          const record = {
            titleTemplate: literalText(node.arguments[0], sf),
            line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
            fixtures,
            steps: [],
            checks: [],
            calls: [],
            assertions: 0,
            inputs: [],
            parked: method && PARK_METHODS.has(method) ? { kind: method, reason: "" } : null,
          };
          // const total = 5 inside the test body also fills "${total}" in its step titles
          record.locals = {};
          const locals = (n) => {
            if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isNumericLiteral(n.initializer) || ts.isStringLiteralLike(n.initializer))) {
              record.locals[n.name.text] = n.initializer.text;
            }
            ts.forEachChild(n, locals);
          };
          locals(fn.body);
          const setup = { steps: [], calls: [], inputs: [], assertions: 0 };
          for (const hook of hooks) details(hook.body, setup, [], 0);
          record.calls.push(...setup.calls.map((c) => ({ ...c })));
          details(fn.body, record, record.checks, 0);
          tests.set(record.line, record);
          return;
        }

        if (rootIsTest && method === "beforeEach") return; // handled with its describe
      }
      ts.forEachChild(node, (child) => visit(child, hooks));
    };

    // Top-level beforeEach hooks apply to every test in the file.
    const fileHooks = [];
    for (const statement of sf.statements) {
      const expr = ts.isExpressionStatement(statement) ? statement.expression : null;
      if (expr && ts.isCallExpression(expr) && ts.isPropertyAccessExpression(expr.expression) && expr.expression.name.text === "beforeEach") {
        const hookFn = expr.arguments.find(isFunction);
        if (hookFn) fileHooks.push(hookFn);
      }
    }
    visit(sf, fileHooks);

    const result = { tests, constants };
    fileCache.set(file, result);
    return result;
  }

  return analyse;
}

// ------------------------------------------------------------ placeholders

/** Safely evaluates simple expressions such as `MAX + 1` or `name` (no code execution). */
function evaluate(expr, vars) {
  if (Object.prototype.hasOwnProperty.call(vars, expr)) return vars[expr];
  let node;
  try {
    node = ts.createSourceFile("x.ts", `(${expr})`, ts.ScriptTarget.Latest, true).statements[0]?.expression;
  } catch {
    return undefined;
  }
  const num = (v) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
  const ev = (n) => {
    if (!n) return undefined;
    if (ts.isParenthesizedExpression(n)) return ev(n.expression);
    if (ts.isNumericLiteral(n)) return Number(n.text);
    if (ts.isStringLiteralLike(n)) return n.text;
    if (ts.isIdentifier(n)) return Object.prototype.hasOwnProperty.call(vars, n.text) ? num(vars[n.text]) : undefined;
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken) {
      const v = ev(n.operand);
      return typeof v === "number" ? -v : undefined;
    }
    if (ts.isPropertyAccessExpression(n) && n.name.text === "length") {
      const v = ev(n.expression);
      return typeof v === "string" ? v.length : undefined;
    }
    if (ts.isConditionalExpression(n)) {
      const test = ev(n.condition);
      return test === undefined ? undefined : test ? ev(n.whenTrue) : ev(n.whenFalse);
    }
    if (ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.ExclamationToken) {
      const v = ev(n.operand);
      return v === undefined ? undefined : !v;
    }
    if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateExpression(n)) {
      let out = n.head.text;
      for (const span of n.templateSpans) {
        const v = ev(span.expression);
        if (v === undefined) return undefined;
        out += String(v) + span.literal.text;
      }
      return out;
    }
    if (ts.isBinaryExpression(n)) {
      const a = ev(n.left);
      const b = ev(n.right);
      if (a === undefined || b === undefined) return undefined;
      switch (n.operatorToken.kind) {
        case ts.SyntaxKind.EqualsEqualsEqualsToken:
        case ts.SyntaxKind.EqualsEqualsToken: return a === b;
        case ts.SyntaxKind.ExclamationEqualsEqualsToken:
        case ts.SyntaxKind.ExclamationEqualsToken: return a !== b;
        case ts.SyntaxKind.LessThanToken: return a < b;
        case ts.SyntaxKind.GreaterThanToken: return a > b;
        case ts.SyntaxKind.LessThanEqualsToken: return a <= b;
        case ts.SyntaxKind.GreaterThanEqualsToken: return a >= b;
        case ts.SyntaxKind.AmpersandAmpersandToken: return a && b;
        case ts.SyntaxKind.BarBarToken: return a || b;
        case ts.SyntaxKind.PlusToken: return a + b;
        case ts.SyntaxKind.MinusToken: return typeof a === "number" && typeof b === "number" ? a - b : undefined;
        case ts.SyntaxKind.AsteriskToken: return typeof a === "number" && typeof b === "number" ? a * b : undefined;
        case ts.SyntaxKind.SlashToken: return typeof a === "number" && typeof b === "number" ? a / b : undefined;
        default: return undefined;
      }
    }
    return undefined;
  };
  const value = ev(node);
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

/** Fills `${x}` placeholders in steps using values captured from the real test title. */
export function resolvePlaceholders(record, constants, actualTitle) {
  const vars = { ...constants, ...record.locals };
  const parts = record.titleTemplate.split(/\$\{([^}]*)\}/);
  if (parts.length > 1) {
    const pattern = parts.map((part, i) => (i % 2 === 0 ? part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "(.*?)")).join("");
    const match = new RegExp(`^${pattern}$`, "s").exec(actualTitle);
    if (match) parts.filter((_, i) => i % 2 === 1).forEach((expr, i) => (vars[expr.trim()] = match[i + 1]));
  }
  const fill = (value, keep) => value.replace(/\$\{([^}]*)\}/g, (whole, expr) => evaluate(expr.trim(), vars) ?? (keep ? whole : `‹${expr.trim()}›`));
  const mapDetails = (list) => list.map((d) => ({ kind: d.kind, text: fill(d.text, true) }));
  return {
    steps: record.steps.map((step) => ({ title: fill(step.title, false), depth: step.depth, details: mapDetails(step.details) })),
    checks: mapDetails(record.checks),
    calls: record.calls.map((call) => {
      if (!call.status || !String(call.status).includes("${")) return call;
      const status = fill(String(call.status), true);
      return { ...call, status: status.includes("${") ? undefined : status };
    }),
  };
}
