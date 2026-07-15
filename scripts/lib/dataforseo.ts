/**
 * DataForSEO API client — shared by all SEO agent scripts.
 * Uses Basic Auth over HTTPS. No external dependencies (Node 18+ fetch).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, env } from "./env.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Cache lives alongside the project's config (.claude/seo/.cache) so each
// project caches its own DataForSEO responses; falls back next to the scripts.
const CACHE_DIR = resolve(CONFIG_DIR ?? __dirname, ".cache");

const LOGIN = env.DATAFORSEO_LOGIN || env.DATAFORSEO_USERNAME;
const PASSWORD = env.DATAFORSEO_PASSWORD;

const BASE_URL = "https://api.dataforseo.com/v3";

// Credentials are checked lazily, at first request — not at import. That lets
// GA4/GSC-only tooling (e.g. ping.ts) import this module without DataForSEO
// creds; only scripts that actually call DataForSEO require them.
function authHeader(): string {
  if (!LOGIN || !PASSWORD) {
    throw new Error(
      "DATAFORSEO_LOGIN (or DATAFORSEO_USERNAME) and DATAFORSEO_PASSWORD required in .env",
    );
  }
  return `Basic ${Buffer.from(`${LOGIN}:${PASSWORD}`).toString("base64")}`;
}

// ---------------------------------------------------------------------- cache
//
// DataForSEO is pay-per-request. The same endpoint + payload yields the same
// data within its freshness window, so we persist responses to disk keyed by
// sha1(method + endpoint + canonicalized body). Re-running a script with the
// same args is then free until the TTL expires.
//
//   SEO_CACHE_TTL      cache lifetime in seconds (default 7 days)
//   SEO_NO_CACHE=1     disable the cache for the whole process
//   SEO_CACHE_VERBOSE  set to "0" to silence the [cache]/[live] stderr log
//   --no-cache         CLI flag honored by every script (parsed here, globally)
//
// Delete .claude/agents/seo/.cache/ to force a full re-fetch.

const DEFAULT_TTL = 7 * 24 * 3600;
const CACHE_TTL = Number.parseInt(env.SEO_CACHE_TTL ?? "", 10) || DEFAULT_TTL;
const CACHE_DISABLED = process.argv.includes("--no-cache") || env.SEO_NO_CACHE === "1";
const CACHE_VERBOSE = env.SEO_CACHE_VERBOSE !== "0";

/** Deterministic JSON: object keys sorted at every level so the hash is stable. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function cachePath(method: string, endpoint: string, body?: unknown): string {
  const canon = stableStringify({ m: method, e: endpoint, b: body ?? null });
  const hash = createHash("sha1").update(canon).digest("hex").slice(0, 16);
  const safe = endpoint.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");
  return resolve(CACHE_DIR, `${method}__${safe}__${hash}.json`);
}

function cacheRead<T>(path: string, endpoint: string): T | null {
  if (!existsSync(path)) return null;
  const ageSec = (Date.now() - statSync(path).mtimeMs) / 1000;
  if (ageSec >= CACHE_TTL) return null;
  if (CACHE_VERBOSE) {
    process.stderr.write(`  [cache ${Math.round(ageSec / 3600)}h] ${endpoint}\n`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function cacheWrite(path: string, data: unknown): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
    // Keep cache contents out of git.
    writeFileSync(resolve(CACHE_DIR, ".gitignore"), "*\n!.gitignore\n");
  }
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/** Raised on a task-level (per-keyword) DataForSEO error when callers opt to throw. */
export class DataForSEOError extends Error {
  constructor(
    message: string,
    readonly endpoint?: string,
  ) {
    super(message);
    this.name = "DataForSEOError";
  }
}

// Hard ceiling on a single request so a hung connection can't stall the agent.
const REQUEST_TIMEOUT_MS = (Number.parseInt(env.SEO_REQUEST_TIMEOUT ?? "", 10) || 180) * 1000;

/** fetch() with an AbortController timeout and a clear timeout message. */
async function fetchWithTimeout(url: string, init: RequestInit, endpoint: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`DataForSEO ${endpoint}: request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RequestOptions {
  /** Read/write the on-disk cache. Default: true for POST, false for GET. */
  useCache?: boolean;
}

export interface DataForSEOResponse<T = unknown> {
  version: string;
  status_code: number;
  status_message: string;
  time: string;
  cost: number;
  tasks_count: number;
  tasks_error: number;
  tasks: Array<{
    id: string;
    status_code: number;
    status_message: string;
    time: string;
    cost: number;
    result_count: number;
    path: string[];
    data: Record<string, unknown>;
    result: T[] | null;
  }>;
}

export async function dataforseoPost<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>[],
  opts: RequestOptions = {},
): Promise<DataForSEOResponse<T>> {
  const useCache = (opts.useCache ?? true) && !CACHE_DISABLED;
  const path = cachePath("POST", endpoint, body);

  if (useCache) {
    const hit = cacheRead<DataForSEOResponse<T>>(path, endpoint);
    if (hit) return hit;
  }
  if (CACHE_VERBOSE) process.stderr.write(`  [live]      ${endpoint}\n`);

  const res = await fetchWithTimeout(
    `${BASE_URL}${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
    endpoint,
  );

  if (!res.ok) {
    throw new Error(`DataForSEO ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as DataForSEOResponse<T>;
  // Only cache a clean response — never persist a failed request.
  if (useCache && data.status_code === 20000) cacheWrite(path, data);
  return data;
}

export async function dataforseoGet<T = unknown>(
  endpoint: string,
  opts: RequestOptions = {},
): Promise<DataForSEOResponse<T>> {
  // GET endpoints here are volatile (balance, crawl status) — cache off by default.
  const useCache = (opts.useCache ?? false) && !CACHE_DISABLED;
  const path = cachePath("GET", endpoint);

  if (useCache) {
    const hit = cacheRead<DataForSEOResponse<T>>(path, endpoint);
    if (hit) return hit;
  }
  if (CACHE_VERBOSE) process.stderr.write(`  [live]      ${endpoint}\n`);

  const res = await fetchWithTimeout(
    `${BASE_URL}${endpoint}`,
    {
      method: "GET",
      headers: { Authorization: authHeader() },
    },
    endpoint,
  );

  if (!res.ok) {
    throw new Error(`DataForSEO ${res.status}: ${res.statusText}`);
  }

  const data = (await res.json()) as DataForSEOResponse<T>;
  if (useCache && data.status_code === 20000) cacheWrite(path, data);
  return data;
}

/**
 * Normalized per-task view of a response. DataForSEO nests data as
 * tasks[i].result[j].items[], with a status_code on every level. These helpers
 * flatten that shape and surface task-level errors without throwing, so batch
 * scripts (one task per keyword) can report a failed keyword and still emit the
 * rest.
 */
export interface TaskView<T> {
  /** true when the task succeeded and returned at least one result wrapper */
  ok: boolean;
  /** the seed keyword/target echoed back in task.data, when present */
  keyword: string | null;
  /** first result wrapper (the common case), or null */
  result: T | null;
  /** all result wrappers for this task */
  results: T[];
  /** task-level error message, or null on success */
  error: string | null;
  /** cost of this task in USD */
  cost: number;
}

/** Map a response to one normalized TaskView per task. Never throws. */
export function tasks<T>(res: DataForSEOResponse<T>): TaskView<T>[] {
  return (res.tasks ?? []).map((t) => {
    const ok = t.status_code === 20000 && !!t.result?.length;
    return {
      ok,
      keyword: (t.data?.keyword as string | undefined) ?? null,
      result: t.result?.[0] ?? null,
      results: t.result ?? [],
      error: t.status_code === 20000 ? null : (t.status_message ?? "Unknown error"),
      cost: t.cost ?? 0,
    };
  });
}

/** First task as a normalized TaskView (single-target endpoints). */
export function firstTask<T>(res: DataForSEOResponse<T>): TaskView<T> {
  return (
    tasks(res)[0] ?? { ok: false, keyword: null, result: null, results: [], error: "No tasks returned", cost: 0 }
  );
}

/** Sum the cost across all tasks in a response. */
export function totalCost(res: DataForSEOResponse): number {
  return (res.tasks ?? []).reduce((sum, t) => sum + (t.cost ?? 0), 0);
}

/** Parse common CLI args: --location <code>, --lang <code>, --limit <n>, --device <desktop|mobile> */
export function parseArgs(args: string[]): {
  positional: string[];
  location: number;
  lang: string;
  limit: number;
  device: string;
} {
  const positional: string[] = [];
  let location = 2840; // US
  let lang = "en";
  let limit = 20;
  let device = "desktop";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--location" && args[i + 1]) {
      location = Number.parseInt(args[++i], 10);
    } else if (arg === "--lang" && args[i + 1]) {
      lang = args[++i];
    } else if (arg === "--limit" && args[i + 1]) {
      limit = Number.parseInt(args[++i], 10);
    } else if (arg === "--device" && args[i + 1]) {
      device = args[++i];
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
  }

  return { positional, location, lang, limit, device };
}

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printError(msg: string): void {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

export { env };
