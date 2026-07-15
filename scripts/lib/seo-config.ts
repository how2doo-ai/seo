/**
 * Central, editable configuration for the SEO agent's analysis scripts.
 *
 * This is the one place to tune the agent to YOUR niche: which domains count as
 * "strong" competition, how high demand must be to bother, how the seasonal-
 * timing boost is shaped, and the default market.
 *
 * The defaults here are niche-agnostic (only universal authorities like
 * Wikipedia / Reddit / YouTube are pre-seeded). Add your niche's authority
 * sites via SEO_STRONG_DOMAINS in .env — no code edit needed. Everything else
 * also has a sane default overridable from .env (see the SEO_* vars below).
 * Edit this file directly only when you want to change the scoring shape itself.
 */

import { env } from "./env.js";

/** Split a comma/space separated env var into a clean lowercase list. */
function envList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function envInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
}

function envNum(value: string | undefined, fallback: number): number {
  const n = Number.parseFloat(value ?? "");
  return Number.isFinite(n) ? n : fallback;
}

/**
 * High-authority domains that are hard to outrank in essentially any niche.
 * When one holds a top-3 organic spot, that result is "strong". The competition
 * gate uses this set. These defaults are niche-agnostic — add YOUR vertical's
 * authority sites from .env with SEO_STRONG_DOMAINS=site1.com,site2.com (extends
 * this list), or SEO_STRONG_DOMAINS_REPLACE=1 to use only the env list.
 *
 * Example for a travel niche:
 *   SEO_STRONG_DOMAINS=tripadvisor.com,lonelyplanet.com,booking.com,expedia.com,
 *   thecrazytourist.com,roughguides.com,timeout.com,cntraveler.com
 */
const DEFAULT_STRONG_DOMAINS = [
  // Encyclopedic / reference
  "wikipedia.org",
  "britannica.com",
  // User-generated giants that dominate informational SERPs everywhere
  "reddit.com",
  "quora.com",
  "youtube.com",
  "medium.com",
  "pinterest.com",
];

const strongDomains = new Set<string>(
  env.SEO_STRONG_DOMAINS_REPLACE === "1"
    ? envList(env.SEO_STRONG_DOMAINS)
    : [...DEFAULT_STRONG_DOMAINS, ...envList(env.SEO_STRONG_DOMAINS)],
);

export interface SeoConfig {
  /** Default DataForSEO location code (2840 = US). */
  defaultLocation: number;
  /** Default language code. */
  defaultLang: string;
  /** Domains treated as strong/hard-to-beat competition. */
  strongDomains: Set<string>;
  gates: {
    /** Demand gate: peak (or current) monthly volume must be at least this. */
    demandMinVolume: number;
    /**
     * Competition gate passes when there's no AI Overview, OR the top-3 is
     * mostly weak. `aioMaxStrongTop3` is the most strong-domain top-3 results
     * tolerated when an AI Overview IS present (default 1 → needs ≥2 weak).
     */
    aioMaxStrongTop3: number;
    /**
     * Fit gate: does our catalog/content actually answer this query? Only
     * enforced when true. When false (default), fit always passes — useful for
     * scoring a raw keyword list with no hand-classification.
     */
    enforceFit: boolean;
  };
  /**
   * Seasonal timing boost. Pages take ~2–8 weeks to index & rank, so a keyword
   * whose seasonal peak lands inside that window is worth publishing for NOW.
   * Evergreen keywords (low amplitude) get no boost (mult 1.0).
   */
  timing: {
    minWeeks: number; // below this: too late to rank for this peak → mult 1.0
    sweetSpotMaxWeeks: number; // minWeeks..here → sweetSpotMult
    sweetSpotMult: number;
    goodMaxWeeks: number; // sweetSpot..here → goodMult
    goodMult: number;
    /** amplitude (peak/trough) below this is considered evergreen. */
    evergreenAmplitude: number;
  };
  /** Where ranked scoring artifacts are written. */
  outputDir: string;
}

export const config: SeoConfig = {
  defaultLocation: envInt(env.SEO_DEFAULT_LOCATION, 2840),
  defaultLang: env.SEO_DEFAULT_LANG || "en",
  strongDomains,
  gates: {
    demandMinVolume: envInt(env.SEO_DEMAND_MIN_VOLUME, 500),
    aioMaxStrongTop3: envInt(env.SEO_AIO_MAX_STRONG_TOP3, 1),
    enforceFit: env.SEO_ENFORCE_FIT === "1",
  },
  timing: {
    minWeeks: envInt(env.SEO_TIMING_MIN_WEEKS, 2),
    sweetSpotMaxWeeks: envInt(env.SEO_TIMING_SWEETSPOT_WEEKS, 8),
    sweetSpotMult: envNum(env.SEO_TIMING_SWEETSPOT_MULT, 2.0),
    goodMaxWeeks: envInt(env.SEO_TIMING_GOOD_WEEKS, 16),
    goodMult: envNum(env.SEO_TIMING_GOOD_MULT, 1.5),
    evergreenAmplitude: envNum(env.SEO_EVERGREEN_AMPLITUDE, 2.0),
  },
  // scripts/ -> seo -> agents -> .claude -> <project root>/agents-info/seo/scored
  outputDir: env.SEO_OUTPUT_DIR || "agents-info/seo/scored",
};

/** Strip www. / trailing dot and lowercase, so 'www.Astrology.com.' → 'astrology.com'. */
export function normalizeDomain(domain: string | null | undefined): string {
  if (!domain) return "";
  let d = domain.trim().toLowerCase().replace(/\.+$/, "");
  if (d.startsWith("www.")) d = d.slice(4);
  return d;
}

/** True when a domain (any form) is in the strong-authority set. */
export function isStrongDomain(domain: string | null | undefined): boolean {
  return config.strongDomains.has(normalizeDomain(domain));
}
