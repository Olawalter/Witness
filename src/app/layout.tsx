import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import type { ReactNode } from "react";

import { AppFrame } from "@/components/shell/app-frame";

import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });
const serif = Newsreader({ subsets: ["latin"], weight: ["300", "400"], variable: "--font-newsreader", display: "swap" });

export const metadata: Metadata = {
  title: { default: "WITNESS — Did it actually happen?", template: "%s · WITNESS" },
  description:
    "WITNESS verifies real-world obligations through evidence and GenLayer consensus: a bonded obligation, permitted evidence sources, a verdict reached by validators, and a settlement that follows from it.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`}>
      <body>
        <AppFrame>{children}</AppFrame>
      </body>
    </html>
  );
}
