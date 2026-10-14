// Reads an OpenAPI (3.x) or Swagger (2.0) file and matches its operations to the calls found in tests.
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

export async function loadOpenApi(file, basePath) {
  const text = readFileSync(file, "utf8");
  let doc;
  if ([".yaml", ".yml"].includes(extname(file).toLowerCase())) {
    let yaml;
    try {
      yaml = await import("yaml");
    } catch {
      throw new Error(`Reading ${file} needs the "yaml" package: npm i -D yaml (or pass a .json spec)`);
    }
    doc = yaml.parse(text);
  } else {
    doc = JSON.parse(text);
  }

  let prefix = basePath;
  if (prefix === undefined) {
    const server = doc.servers?.[0]?.url ?? doc.basePath ?? "";
    prefix = server.replace(/^https?:\/\/[^/]+/, "").replace(/\{[^}]+\}/g, "");
  }
  prefix = (prefix || "").replace(/\/$/, "");

  const operations = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = item?.[method];
      if (!op) continue;
      operations.push({
        method: method.toUpperCase(),
        path: `${prefix}${path}`,
        summary: op.summary ?? op.operationId ?? "",
        tag: op.tags?.[0] ?? "",
        deprecated: Boolean(op.deprecated),
        responses: Object.keys(op.responses ?? {}).filter((code) => /^\d{3}$/.test(code)).sort(),
      });
    }
  }
  return { title: doc.info?.title ?? "", version: doc.info?.version ?? "", operations };
}

const toRegex = (path) =>
  new RegExp(`^${path.split("/").map((seg) => (/^\{[^}]*\}$/.test(seg) ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/")}/?$`);

/** True when a called path (which may contain `{x}` placeholders) can hit the spec path. */
export function pathMatches(specPath, calledPath) {
  const spec = specPath.split("/");
  const called = calledPath.split("/");
  if (spec.length !== called.length) return toRegex(specPath).test(calledPath);
  return spec.every((seg, i) => seg === called[i] || /^\{[^}]*\}$/.test(seg) || /^\{[^}]*\}$/.test(called[i]));
}
