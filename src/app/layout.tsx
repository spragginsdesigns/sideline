import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono, Oswald } from "next/font/google";
import "./globals.css";

const oswald = Oswald({ subsets: ["latin"], variable: "--font-oswald", weight: ["400", "500", "600", "700"] });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["500", "600", "700"] });

export const metadata: Metadata = {
  title: "Sideline · the AI treasurer for youth sports teams",
  description:
    "Paste the coach's group-chat message. Sideline turns it into a PayPal invoice for every family, nudges late payers in their own language, pays the referee when the game is final, and shows parents where every dollar went.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#070b14",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${oswald.variable} ${hanken.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
