import type { Service } from "./types";

export type StylistConfig = {
  id: string;
  name: string;
  handle: string;
  salon: string;
  address: string;
  bookingUrl: string;
  initials: string;
  location: string;
  services: Service[];
};

export const MIA_CONFIG: StylistConfig = {
  id: "shen",
  name: "Shen",
  handle: "shen",
  salon: "Shen Hair Studio",
  address: "160 Madison Ave., Suite 13, New York, NY 10016",
  bookingUrl: "book.kasa.app/shen",
  initials: "S",
  location: "Shen Hair Studio · 160 Madison Ave., Suite 13, New York, NY",
  services: [
    // Haircut
    {
      id: "svc-short-cut",
      name: "Short Hair Cut / Barber Short",
      category: "Haircut",
      priceLabel: "$90",
      durationMinutes: 60,
      durationLabel: "1 hr",
      status: "online",
    },
    {
      id: "svc-medium-long-cut",
      name: "Medium / Long Hair Cut",
      category: "Haircut",
      priceLabel: "$120",
      durationMinutes: 75,
      durationLabel: "1 hr 15 min",
      status: "online",
    },
    // Treatment
    {
      id: "svc-head-spa",
      name: "Head Spa (Scalp Treatment)",
      category: "Treatment",
      priceLabel: "$150",
      durationMinutes: 60,
      durationLabel: "1 hr",
      status: "online",
    },
    {
      id: "svc-keratin",
      name: "Keratin Treatment",
      category: "Treatment",
      priceLabel: "$450",
      durationMinutes: 150,
      durationLabel: "2 hr 30 min",
      status: "consultation",
    },
    {
      id: "svc-milbon",
      name: "Milbon Treatment",
      category: "Treatment",
      priceLabel: "$150",
      durationMinutes: 60,
      durationLabel: "1 hr",
      status: "online",
    },
    // Perm
    {
      id: "svc-cut-down-perm",
      name: "Hair Cut + Down Perm",
      category: "Perm",
      priceLabel: "$165",
      durationMinutes: 90,
      durationLabel: "1 hr 30 min",
      status: "online",
    },
    {
      id: "svc-mens-perm-cut",
      name: "Men's Perm + Hair Cut",
      category: "Perm",
      priceLabel: "$255",
      durationMinutes: 120,
      durationLabel: "2 hr",
      status: "online",
    },
    {
      id: "svc-bang-perm",
      name: "Bang Perm",
      category: "Perm",
      priceLabel: "$100",
      durationMinutes: 60,
      durationLabel: "1 hr",
      status: "online",
    },
    {
      id: "svc-womens-regular-perm",
      name: "Women's Regular Perm",
      category: "Perm",
      priceLabel: "$280",
      durationMinutes: 180,
      durationLabel: "3 hr",
      status: "online",
    },
    {
      id: "svc-womens-digital-perm",
      name: "Women's Digital Perm",
      category: "Perm",
      priceLabel: "$480",
      durationMinutes: 240,
      durationLabel: "4 hr",
      status: "consultation",
    },
    {
      id: "svc-straightening-perm",
      name: "Straightening Perm",
      category: "Perm",
      priceLabel: "$450",
      durationMinutes: 240,
      durationLabel: "4 hr",
      status: "consultation",
    },
    // Color
    {
      id: "svc-root-touchup",
      name: "Root Touch-up",
      category: "Color",
      priceLabel: "$130+",
      durationMinutes: 90,
      durationLabel: "1 hr 30 min",
      status: "online",
    },
    {
      id: "svc-full-color",
      name: "Full Color",
      category: "Color",
      priceLabel: "$300",
      durationMinutes: 120,
      durationLabel: "2 hr",
      status: "online",
    },
  ],
};

export const STYLIST_CONFIGS: Record<string, StylistConfig> = {
  shen: MIA_CONFIG,
};
