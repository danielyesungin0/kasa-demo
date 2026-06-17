import { shenTest } from "../fixtures/providers/shen-test.mjs";
import { nails } from "../fixtures/providers/nails.mjs";
import { generic } from "../fixtures/providers/generic.mjs";
import { TEMPLATES } from "./templates.mjs";
import { continuityScenarios } from "./continuity-scenarios.mjs";

/**
 * The provider registry. Beta: only shen-test is seeded (runs live). nails /
 * generic are present so the cross-product is real and ready — they're skipped
 * at runtime until seeded:true.
 */
export const PROFILES = [shenTest, nails, generic];

/**
 * Build the full scenario list: every template × every profile, plus the
 * provider-specific continuity scenarios. Templates that return null for a
 * given profile (e.g. closed-day for an always-open provider) are dropped.
 *
 * Only SEEDED providers produce runnable scenarios — unseeded stubs are counted
 * as "skipped" so the suite reports honest coverage without hitting empty rows.
 */
export function buildScenarios() {
  const scenarios = [];
  const skipped = [];

  for (const profile of PROFILES) {
    const fromTemplates = TEMPLATES.map((t) => t(profile)).filter(Boolean);
    const cont = continuityScenarios(profile);
    const all = [...fromTemplates, ...cont];

    if (!profile.seeded) {
      skipped.push({ slug: profile.slug, count: all.length });
      continue;
    }
    scenarios.push(...all.map((s) => ({ ...s, slug: profile.slug })));
  }

  return { scenarios, skipped };
}
