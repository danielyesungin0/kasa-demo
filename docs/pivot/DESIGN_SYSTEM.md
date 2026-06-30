# Kasa Design System — carry forward + tattoo adjustments

## Verdict: KEEP the existing system. Adjust, don't rebuild.
The current aesthetic — calm, premium, editorial, warm-neutral, beautiful type —
is *more* fitting for tattoo (portfolio-adjacent) than it was for a SaaS inbox.
It's a real asset. Port the tokens to web verbatim; evolve the energy slightly
toward editorial/portfolio.

## Tokens (port verbatim from theme/colors.ts → CSS vars / Tailwind)
**Surfaces / ink (warm neutrals):**
- bg `#F4F0E9` · surface `#FFFFFF` · surface-2 `#FAF7F1` · bg-warm `#ECE6DB`
- ink `#211D18` · ink-2 `#534B41` · ink-3 `#746A5C` · ink-4 `#9A9082`
- line `#E9E2D6` · line-2 `#DED6C7`

**Accents:**
- accent (terracotta) `#C56B5C` · accent-strong `#A94B3E` · accent-soft `#F5E3DD`
- plum `#7E6488` (secondary) + the ok/warn/err set from the old file
- **Per-artist accent** (`artist_profiles.accent`) — let an artist tint their own
  profile/intake (a small touch that makes the link feel theirs). Default to the
  Kasa terracotta.

**Type:** Inter (UI) + Fraunces (display/editorial). Keep the scale
(display-lg/display/title/section/body/caption). Lean on Fraunces more on the
public client side for an editorial, gallery feel.

**Radii/spacing:** keep (control 12, control-lg 14, card 18, pill, gutter 20).

## Adjustments for tattoo
1. **Image-forward layouts.** Tattoo is visual. Reference grids, generous image
   tiles, the placement photo treated as a feature. The old inbox was text-first;
   flip toward images on both the intake and the brief.
2. **Editorial intake.** The client flow should feel like a beautifully art-
   directed questionnaire — big Fraunces step titles, one question per screen,
   lots of air. Think "premium magazine quiz," not "form."
3. **Wordmark + domain.** `kasa.ink` (vs `.app`) — the `.ink` is perfect for
   tattoo. Use it in the public footer ("Powered by Kasa", small).
4. **Calm confirmations.** Success/empty states stay understated and warm (reuse
   the old honest, non-hype voice).
5. **Dark option (later).** Many tattoo brands skew dark/editorial. MVP stays in
   the warm-light system (it's distinctive and not what competitors use); a dark
   theme is a fast-follow if artists want it.

## What to drop
- Channel colors/glyphs (ChannelDot), calendar/booking visual language, the
  tab-bar app chrome — none apply to a web link + dashboard.

## Component visual specs to preserve
- **Text** variants, **Toast**, **ConfirmDialog**, **Skeleton**, **ImageViewer**
  — re-author for web keeping the exact look.
- Buttons: primary = ink or accent-strong fill, pill/control radius; secondary =
  warm-fill; destructive = err. (Same as the ConfirmDialog rework.)

## Voice
Calm, plainspoken, premium. Never hypey, never "🔥 grow your business 🚀". The
client flow speaks like a thoughtful artist's assistant; the artist UI is quiet
and gets out of the way. (Carry the old product's honesty principle: never fake,
never overpromise.)

## Why this matters competitively
Google Forms/Jotform look generic and clinical. Kasa's warm editorial system is
an instant, visible differentiator the moment a client taps the link — the design
*is* part of the wedge.
