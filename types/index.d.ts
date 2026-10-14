export interface ClientMethod {
  /** Index of the argument that holds the expected HTTP status. */
  statusArg?: number;
  /** Status used when that argument is omitted. */
  defaultStatus?: string | number;
  /** "METHOD /path" this method calls, e.g. "POST /v1/orders". */
  endpoint?: string;
}

export interface ClassifyInput {
  file: string;
  title: string;
  tags: string[];
  projects: string[];
  fixtures: string[];
  calls: { kind: "api" | "page"; method: string; path: string; status?: string }[];
  suitePath: string[];
}

export interface CheckRules {
  maxParked?: number;
  noAssertions?: boolean;
  maxDuplicates?: number;
  minApiCoverage?: number;
  minTests?: number;
  noFailed?: boolean;
}

export interface Config {
  /** Page title. Default "Playwright Test Coverage". */
  title?: string;
  /** Output folder. Default "coverage-map". */
  outDir?: string;
  /** Files to write. Default ["html", "json"]. */
  formats?: ("html" | "json" | "md" | "csv")[];
  /** Playwright config file, passed to `playwright test --config`. */
  playwrightConfig?: string;
  /** Only these Playwright projects. */
  projects?: string[];
  /** Only tests matching this regex (passed to `playwright --grep`). */
  grep?: string;
  /** Extra environment variables for `playwright test --list` (e.g. { CI: "true" }). */
  env?: Record<string, string>;
  /** Playwright JSON report of a real run, to show pass/fail/flaky and durations. */
  results?: string;
  /** OpenAPI / Swagger file to measure endpoint coverage against. */
  openapi?: string;
  /** Path prefix added to every OpenAPI path. Default: taken from servers[0].url. */
  openapiBasePath?: string;
  /** Link template for source files, with {file} and {line}. Auto-detected from git; null disables. */
  sourceUrl?: string | null;
  /** Names of the test function. Default ["test", "it"]. */
  testNames?: string[];
  /** API client methods that take an expected status. Usually auto-discovered from imports. */
  clientMethods?: Record<string, ClientMethod>;
  /** Regex for assertion helper functions. Default /^(expect|assert|verify)[A-Z]/. */
  assertionHelpers?: string;
  /** Follow relative imports to discover client methods. Default true. */
  followImports?: boolean;
  /** Similarity (0-1) at which two tests are reported as overlapping. Default 0.85. */
  duplicateThreshold?: number;
  /** Decide the test type (e.g. "api", "ui", "contract"). Default: folder name, fixtures, project name. */
  classify?: (input: ClassifyInput) => string;
  /** CI rules; any failure sets exit code 1. */
  check?: CheckRules;
}

export function defineConfig(config: Config): Config;

export interface Report {
  version: number;
  title: string;
  generatedAt: string;
  types: string[];
  totals: Record<string, any>;
  suites: any[];
  insights: any;
  warnings: string[];
  [key: string]: any;
}

export function createReport(options?: Config & { cwd?: string; listFile?: string }): Promise<Report>;
export function writeReport(report: Report, options?: { cwd?: string; outDir?: string; formats?: Config["formats"] }): string[];
export function generate(options?: Config & { cwd?: string; listFile?: string }): Promise<{ report: Report; files: string[] }>;
export function renderHtml(report: Report): string;
export function renderMarkdown(report: Report, options?: { full?: boolean }): string;
export function renderCsv(report: Report): string;
export function diffReports(before: Report, after: Report): any;
export function renderDiffMarkdown(diff: any, options?: { title?: string }): string;
export function runChecks(report: Report, rules?: CheckRules): string[];
