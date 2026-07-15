/**
 * Project-aware config loader, shared by every SEO-agent script.
 *
 * This tool is meant to be installed once (as a Claude Code plugin, an npm
 * package, or a plain clone) and reused across many projects. The *code* is
 * shared; the *config* — which site, which GA4 property, which credentials —
 * belongs to each project. So we never read config from next to the script.
 * We resolve it from the project being worked on, in this order:
 *
 *   1. $SEO_AGENT_ENV                  — explicit path to an env file (wins)
 *   2. <cwd>/.claude/seo/.env          — the conventional per-project location
 *   3. <cwd>/seo-agent.env             — flat alternative at the project root
 *   4. <script>/../.env                — co-located fallback (in-repo / dev use)
 *   5. <cwd>/.env                      — the project's own root .env: only used
 *      as the config file when it actually defines GSC_* vars, and otherwise
 *      merged underneath the chosen file as a lowest-priority overlay, so a
 *      project can keep its SEO vars in the .env it already has.
 *   6. ~/.config/seo-agent/.env        — user-global overlay, lowest priority
 *      of all: account-wide secrets shared by every project on this machine
 *      (DataForSEO credentials, a canonical key path) live here ONCE instead
 *      of being copy-pasted into each repo. Never holds per-site vars.
 *
 * A service-account JSON key referenced by GSC_SERVICE_ACCOUNT_KEY_FILE is
 * resolved relative to the chosen env file's directory, so the key sits next
 * to the .env that names it (e.g. both in <project>/.claude/seo/).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function candidatePaths(): string[] {
  const paths: string[] = [];
  if (process.env.SEO_AGENT_ENV) paths.push(resolve(process.env.SEO_AGENT_ENV));
  paths.push(resolve(process.cwd(), ".claude/seo/.env"));
  paths.push(resolve(process.cwd(), "seo-agent.env"));
  paths.push(resolve(here, "../.env"));
  return paths;
}

const candidates = candidatePaths();

/** User-global overlay for machine-wide secrets — lowest priority of all. */
const GLOBAL_ENV = resolve(homedir(), ".config/seo-agent/.env");
const globalEnvVars: Record<string, string> = existsSync(GLOBAL_ENV)
  ? parseEnvFile(GLOBAL_ENV)
  : {};

/** The project's own root .env — second-lowest-priority source (see header). */
const ROOT_ENV = resolve(process.cwd(), ".env");
const rootEnvVars: Record<string, string> = existsSync(ROOT_ENV)
  ? parseEnvFile(ROOT_ENV)
  : {};
const rootEnvHasConfig = Boolean(
  rootEnvVars.GSC_SITE_URL ||
    rootEnvVars.GSC_SERVICE_ACCOUNT_KEY ||
    rootEnvVars.GSC_SERVICE_ACCOUNT_KEY_FILE,
);

/** The env file actually used (the first that exists), or null if none found. */
export const ENV_PATH: string | null =
  candidates.find(existsSync) ?? (rootEnvHasConfig ? ROOT_ENV : null);

/** Directory holding the chosen env file — the project's SEO config dir. */
export const CONFIG_DIR: string | null = ENV_PATH ? dirname(ENV_PATH) : null;

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const content = readFileSync(path, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnv(): Record<string, string> {
  if (!ENV_PATH) {
    console.error("Error: no SEO-agent config found. Looked for:");
    for (const p of candidates) console.error(`  - ${p}`);
    console.error(`  - ${ROOT_ENV} (with GSC_* vars in it)`);
    console.error(
      "\nRun the plugin's scripts/init.sh to scaffold .claude/seo/.env,",
    );
    console.error(
      "put GSC_* vars in your project's root .env, or point SEO_AGENT_ENV at a file. See SETUP.md.",
    );
    process.exit(1);
  }
  // Priority: process env (CI/shell secrets) > chosen env file > root .env
  // overlay > user-global ~/.config/seo-agent/.env.
  const overlay = ENV_PATH === ROOT_ENV ? {} : rootEnvVars;
  return {
    ...globalEnvVars,
    ...overlay,
    ...parseEnvFile(ENV_PATH),
    ...stringEnv(process.env),
  };
}

/** Narrow process.env (string | undefined) to a plain string record. */
function stringEnv(src: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(src)) if (typeof v === "string") out[k] = v;
  return out;
}

export const env = loadEnv();

/**
 * The Google service-account key as a JSON string, from either an inline value
 * (GSC_SERVICE_ACCOUNT_KEY) or a file (GSC_SERVICE_ACCOUNT_KEY_FILE, resolved
 * relative to the config dir). Returns null when neither is set.
 */
export function serviceAccountKey(): string | null {
  if (env.GSC_SERVICE_ACCOUNT_KEY) return env.GSC_SERVICE_ACCOUNT_KEY;
  const file = env.GSC_SERVICE_ACCOUNT_KEY_FILE;
  if (!file) return null;
  const path = isAbsolute(file) ? file : resolve(CONFIG_DIR ?? process.cwd(), file);
  if (!existsSync(path)) {
    console.error(`Error: service-account key not found at ${path}`);
    console.error(
      "GSC_SERVICE_ACCOUNT_KEY_FILE names it but the file is missing. Download the",
    );
    console.error("key JSON and drop it there, or use inline GSC_SERVICE_ACCOUNT_KEY. See SETUP.md.");
    process.exit(1);
  }
  return readFileSync(path, "utf-8");
}
