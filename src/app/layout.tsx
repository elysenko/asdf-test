import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "City Weather Search",
  description: "Anonymous weather lookup by city name.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
