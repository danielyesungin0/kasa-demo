// Mock data for the Phase-0 prototype (no backend). Mirrors the DATA_MODEL shapes
// loosely so wiring to Supabase later is a swap, not a rewrite.

export type StyleTag = string;

export type Artist = {
  handle: string;
  displayName: string;
  instagram: string;
  studio: string;
  location: string;
  bio: string;
  styleTags: StyleTag[];
  bookingStatus: string;
  responseTime: string;
  budgetRanges: string[];
  depositText: string;
  cancellationText: string;
};

// Sample artist for the prototype: kasa.ink/dizon
export const ARTIST: Artist = {
  handle: "dizon",
  displayName: "Dizon",
  instagram: "@dizon.tattoo",
  studio: "Inkhouse Studio",
  location: "Brooklyn, NY",
  bio: "Korean-inspired blackwork & oriental fineline. Custom pieces, thoughtful compositions. I take time with each design — please share as much detail as you can.",
  styleTags: ["Blackwork", "Oriental", "Fineline", "Custom", "Cover-up"],
  bookingStatus: "Books open for July & August",
  responseTime: "Usually replies within 2–3 days",
  budgetRanges: ["Under $200", "$200–500", "$500–1000", "$1000–2000", "$2000+", "Not sure yet"],
  depositText:
    "A non-refundable deposit of $100 is required to begin design work. It goes toward your final session total.",
  cancellationText:
    "Please give at least 48 hours notice to reschedule. Same-day cancellations forfeit the deposit.",
};

export const REQUEST_TYPES = [
  { id: "custom", label: "Custom", sub: "An original piece designed for you" },
  { id: "flash", label: "Flash", sub: "One of my pre-drawn designs" },
  { id: "cover-up", label: "Cover-up", sub: "Reworking an existing tattoo" },
  { id: "consultation", label: "Consultation", sub: "Not sure yet — let's talk" },
] as const;

export const STYLE_CHIPS = ["Blackwork", "Fineline", "Oriental", "Ornamental", "Color", "Illustrative", "Lettering", "Not sure"];

export const PLACEMENTS = [
  "Forearm", "Upper arm", "Full sleeve", "Hand", "Back", "Chest",
  "Ribs", "Thigh", "Calf", "Shoulder", "Neck", "Ankle", "Other",
];

// Guided size comparisons (the "dramatically better than a form" touch).
export const SIZE_GUIDES = [
  { id: "coin", label: "Coin-sized", sub: "~2–3 cm" },
  { id: "card", label: "Credit card", sub: "~5–8 cm" },
  { id: "phone", label: "Phone-sized", sub: "~10–15 cm" },
  { id: "palm", label: "Palm", sub: "~10 cm" },
  { id: "forearm", label: "Forearm length", sub: "~20–25 cm" },
  { id: "large", label: "Large / sleeve", sub: "30 cm+" },
];

export const IMAGE_CATEGORIES = [
  { id: "style", label: "Style" },
  { id: "composition", label: "Composition" },
  { id: "subject", label: "Subject" },
  { id: "placement", label: "Placement" },
  { id: "color", label: "Color" },
  { id: "past_work", label: "Your past work" },
];
