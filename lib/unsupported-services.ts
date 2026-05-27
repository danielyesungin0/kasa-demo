/**
 * Deterministic unsupported-service detector — shared between the chat
 * route (lib/ai/route safety net) and the chat client (handleTextSubmit
 * pre-dispatch guard).
 *
 * The deterministic NLU intentionally maps things like "bleach" / "balayage"
 * to the Color category because clients ask about them in color-adjacent
 * language. That's fine for parsing intent, but it would steer the user
 * into booking the wrong service. This module is the consistent override:
 * when the message contains one of these terms, the chat refuses to
 * recommend a service and offers a handoff instead.
 *
 * Keep this list synced with the prompt's "Unsupported-service rule"
 * section in lib/ai/provider.ts so the model and the safety net agree.
 *
 * Returns the matched phrase (used in the handoff summary) or null when
 * the message looks supported / ambiguous. False positives are worse than
 * false negatives here — only include terms that are CLEARLY not in a
 * typical solo-stylist hair catalog. If a stylist genuinely offers one
 * of these (e.g. balayage), this would over-block; revisit when we move
 * beyond a single-tenant prototype.
 */

const UNSUPPORTED_TERMS: { re: RegExp; label: string }[] = [
  // Color-adjacent techniques that aren't simple Root Touch-up / Full Color.
  { re: /\bbleach(ed|ing)?\b/, label: "bleach" },
  { re: /\b(platinum|ash\s+blond|icy\s+blond|white\s+blond)\b/, label: "platinum / icy blond" },
  { re: /\bbalayage|baby\s*lights?|baby-?lights?|high\s*lights?|low\s*lights?|foils?\b/, label: "balayage / highlights" },
  { re: /\bombr[eé]|sombr[eé]|dip[-\s]?dye|color\s+melt|colour\s+melt\b/, label: "ombre / dip-dye" },
  // "gloss" alone is too generic (lip gloss); require pairing with "hair"
  // or a color-term phrase like "color gloss".
  { re: /\b(?:hair\s+(?:toner|gloss|glaze)|color\s+(?:toner|gloss|glaze)|hair\s+toner)\b/, label: "toner / gloss / glaze" },
  { re: /\bcolor\s+correction|colour\s+correction|color\s+removal|colour\s+removal|strip(ping)?\s+(my\s+)?color\b/, label: "color correction / removal" },
  { re: /\b(vivid|fashion|pastel|fantasy)\s+(color|colour|hair)\b/, label: "vivid / fashion color" },
  { re: /\bbrazilian\s+blow\s*out\b/, label: "Brazilian blowout" },

  // Cut-adjacent
  { re: /\b(hair\s+)?extensions?\b/, label: "hair extensions" },
  { re: /\b(tape[-\s]?ins?|clip[-\s]?ins?|wefts?|i[-\s]?tips?|k[-\s]?tips?|sew[-\s]?ins?)\b/, label: "extensions" },
  { re: /\bbeard\s+(trim|shave|cut)|\bshav(e|ing)\b|\b(line\s*up|lineup|fade|skin\s+fade|taper)\b/, label: "beard / fade / lineup" },

  // Styling-only (without a cut/perm/color)
  { re: /\bblow\s*out\b|\bblow\s*-?dry\s+only\b|\bjust\s+a?\s+blow\s*-?dry\b/, label: "blowout / blow-dry only" },
  { re: /\b(updo|up\s*-?do|formal\s+style|wedding\s+style|bridal|prom\s+hair)\b/, label: "updo / bridal style" },
  { re: /\bbraid(s|ing)?|\bcornrows?\b|\bbox\s+braids\b|\bfeed[-\s]?in\s+braids\b/, label: "braids" },
  { re: /\bdread(s|locks)?\b|\bloc[s]?\b\s+(install|retwist|maintenance)?/, label: "locs / dreads" },
  { re: /\b(perm\s+rod\s+set|silk\s+press|wash\s+and\s+set)\b/, label: "silk press / set" },

  // Adjacent businesses
  { re: /\b(mani(cure)?|pedi(cure)?|nail\s+(art|polish|fill|gel|acrylic))\b/, label: "nails" },
  { re: /\b(wax(ing)?|threading|brow\s+wax|lip\s+wax|brazilian\s+wax)\b/, label: "waxing / threading" },
  { re: /\bbrow\s+(tint|shape|lamination|tweez)/, label: "brows" },
  { re: /\b(lash\s+(extensions?|lift|tint))\b/, label: "lashes" },
  { re: /\bmakeup\b|\bmake\s*-?\s*up\b/, label: "makeup" },
  { re: /\bfacial\b|\bskincare\b|\bchemical\s+peel\b|\bmicroderm/, label: "facial / skin" },
  { re: /\bmassage\b/, label: "massage" },

  // Scalp / medical-adjacent
  { re: /\bscalp\s+(tattoo|micropigmentation|smp)\b|\bhair\s+transplant\b|\bhair\s+loss\s+treatment\b/, label: "scalp / hair loss treatment" },
];

export function detectUnsupportedService(message: string): string | null {
  const t = ` ${message.toLowerCase()} `;
  for (const { re, label } of UNSUPPORTED_TERMS) {
    if (re.test(t)) return label;
  }
  return null;
}
