import type { CatalogEntry } from "@/lib/engine/catalog";
import { MIA_CATALOG } from "./mia-hair";
import { ARIA_CATALOG } from "./aria-nails";

export type BusinessConfig = {
  id: string;
  name: string;
  type: "hair_salon" | "nail_salon" | "barbershop" | "spa" | string;
  handle: string;
  salon: string;
  address: string;
  location: string;
  bookingUrl: string;
  initials: string;
  catalog: CatalogEntry[];
};

export const BUSINESSES: Record<string, BusinessConfig> = {
  shen: {
    id: "shen",
    name: "Shen",
    type: "hair_salon",
    handle: "shen",
    salon: "Shen Hair Studio",
    address: "160 Madison Ave., Suite 13, New York, NY 10016",
    location: "Shen Hair Studio · 160 Madison Ave., Suite 13, New York, NY",
    bookingUrl: "book.kasa.app/shen",
    initials: "S",
    catalog: MIA_CATALOG,
  },
  "aria-nails": {
    id: "aria-nails",
    name: "Aria",
    type: "nail_salon",
    handle: "aria-nails",
    salon: "Aria Nails",
    address: "88 Prince St, NYC",
    location: "Aria Nails · 88 Prince St, NYC",
    bookingUrl: "https://book.app/aria-nails",
    initials: "A",
    catalog: ARIA_CATALOG,
  },
};

export function getBusinessConfig(id: string): BusinessConfig {
  return BUSINESSES[id] ?? BUSINESSES["mia"];
}

/** The default business — used by /mia route */
export const DEFAULT_BUSINESS = BUSINESSES["mia"];
