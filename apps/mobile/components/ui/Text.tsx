// Accessible text primitive. The prototype is fixed-px; DESIGN.md §3 requires
// real RN text that honors Dynamic Type. This wrapper:
//   - keeps allowFontScaling ON (system font scaling) — accessibility, not polish
//   - caps runaway scaling so layouts don't break (maxFontSizeMultiplier)
//   - maps semantic variants to the theme's fontSize + fontFamily tokens
// Use <Text variant="..."> everywhere instead of raw <RNText> + hardcoded sizes.
import { Text as RNText, type TextProps as RNTextProps } from "react-native";
import { cssInterop } from "nativewind";

cssInterop(RNText, { className: "style" });

type Variant =
  | "display-lg"
  | "display"
  | "title-lg"
  | "title"
  | "section"
  | "body"
  | "body-sm"
  | "caption"
  | "eyebrow"
  | "label";

// variant → theme classes (size token + default family/weight + color).
const VARIANT: Record<Variant, string> = {
  "display-lg": "font-serif text-display-lg text-ink",
  display: "font-serif text-display text-ink",
  "title-lg": "font-semibold text-title-lg text-ink",
  title: "font-semibold text-title text-ink",
  section: "font-semibold text-section text-ink",
  body: "font-sans text-body text-ink-2",
  "body-sm": "font-sans text-body-sm text-ink-3",
  caption: "font-sans text-caption text-ink-3",
  eyebrow: "font-bold text-eyebrow uppercase text-ink-3",
  label: "font-bold text-label uppercase text-ink-4",
};

// Display/number contexts want tabular figures (DESIGN.md §3).
export type TextProps = RNTextProps & {
  variant?: Variant;
  className?: string;
  tabular?: boolean;
  /** Cap font scaling. Default 1.4 keeps dense UI legible without breaking. */
  maxScale?: number;
};

export function Text({
  variant = "body",
  className,
  tabular,
  maxScale = 1.4,
  style,
  ...rest
}: TextProps) {
  return (
    <RNText
      allowFontScaling
      maxFontSizeMultiplier={maxScale}
      className={`${VARIANT[variant]} ${className ?? ""}`}
      style={[tabular ? { fontVariant: ["tabular-nums"] } : null, style]}
      {...rest}
    />
  );
}
