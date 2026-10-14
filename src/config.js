// Loads pw-coverage-map.config.{mjs,js,cjs,json} or the "pwCoverageMap" key in package.json.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const FILES = ["pw-coverage-map.config.mjs", "pw-coverage-map.config.js", "pw-coverage-map.config.cjs", "pw-coverage-map.config.json"];

export const DEFAULTS = {
  title: "Playwright Test Coverage",
  outDir: "coverage-map",
  formats: ["html", "json"],
  testNames: ["test", "it"],
  clientMethods: {},
  assertionHelpers: undefined,
  followImports: true,
  duplicateThreshold: 0.85,
  projects: [],
  playwrightConfig: undefined,
  results: undefined,
  openapi: undefined,
  openapiBasePath: undefined,
  sourceUrl: undefined,
  env: {},
  check: {},
};

export async function loadConfig(cwd, explicit) {
  let file = explicit ? resolve(cwd, explicit) : FILES.map((f) => resolve(cwd, f)).find(existsSync);
  if (explicit && !existsSync(file)) throw new Error(`Config file not found: ${explicit}`);
  if (!file) {
    const pkg = resolve(cwd, "package.json");
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, "utf8"));
      if (json.pwCoverageMap) return { config: json.pwCoverageMap, file: "package.json" };
    }
    return { config: {}, file: null };
  }
  if (file.endsWith(".json")) return { config: JSON.parse(readFileSync(file, "utf8")), file };
  const mod = await import(pathToFileURL(file).href);
  return { config: mod.default ?? mod, file };
}

/** Typed helper for config files: export default defineConfig({ ... }) */
export const defineConfig = (config) => config;
