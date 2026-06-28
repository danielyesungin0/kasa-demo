import type { Metadata, Viewport } from "next";
import { Fraunces, Inter_Tight } from "next/font/google";
import "./globals.css";
import { AppointmentsProvider } from "@/lib/appointments-store";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["400", "500", "600"],
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Kasa — Book your appointment",
  description:
    "Send one link. Clients pick a time instantly. Bookings stay organized.",
};

// viewport-fit=cover enables env(safe-area-inset-*) on iOS so we can
// pad around the home indicator + notch. maximumScale=1 prevents Safari
// from auto-zooming on input focus when the input font-size is <16px.
// interactiveWidget=resizes-content tells modern browsers (Chrome/Edge)
// to shrink the layout viewport when the soft keyboard opens, matching
// what visualViewport sees on iOS.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${fraunces.variable} ${interTight.variable}`}>
      <body>
        <AppointmentsProvider>{children}</AppointmentsProvider>
      </body>
    </html>
  );
}
