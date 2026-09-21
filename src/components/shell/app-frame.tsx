"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { ConfigProblem } from "@/components/shell/config-problem";
import { NetworkNotice } from "@/components/wallet/network-notice";
import { WalletButton } from "@/components/wallet/wallet-button";
import { configResult } from "@/lib/genlayer/config";
import { WalletProvider } from "@/lib/wallet/wallet";

/** The seal: brackets closed around a mark, stamped on the record. */
export function Seal({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" aria-hidden="true">
      <rect width="24" height="24" fill="#111111" />
      <path d="M7.5 5.5H5.5v13h2M16.5 5.5h2v13h-2" stroke="#F7F6F2" strokeWidth="1.6" strokeLinecap="square" />
      <path d="M9 12.2l2.2 2.3L15 9.6" stroke="#D99A28" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

const NAV = [
  { href: "/obligations", label: "Explore" },
  { href: "/obligations/new", label: "Create obligation" },
];

export function AppFrame({ children }: { children: ReactNode }) {
  if (!configResult.ok) return <ConfigProblem problems={configResult.problems} />;
  return (
    <WalletProvider>
      <Frame>{children}</Frame>
    </WalletProvider>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const config = configResult.ok ? configResult.config : null;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="WITNESS, home">
            <Seal />
            <span className="font-mono text-sm font-medium tracking-[0.22em]">WITNESS</span>
          </Link>
          <nav aria-label="Sections" className="flex items-center gap-5 text-sm">
            {NAV.map((item) => {
              const on = item.href === "/obligations" ? pathname.startsWith("/obligations") && pathname !== "/obligations/new" : pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={on ? "page" : undefined}
                  className={`border-b-2 pb-0.5 transition-colors ${on ? "border-amber text-ink" : "border-transparent text-muted hover:text-ink"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="label hidden sm:inline">{config?.networkName}</span>
            <WalletButton />
          </div>
        </div>
      </header>

      <NetworkNotice />

      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-8">
        {children}
      </main>

      <footer className="rule mt-16">
        <div className="mx-auto max-w-6xl px-4 py-6 text-sm text-muted sm:px-8">
          <p>
            Everything shown here is read from the WITNESS Intelligent Contract on {config?.networkName}. This interface
            stores nothing, decides nothing, and holds no key.
          </p>
          {config ? (
            <p className="mt-2">
              <a
                className="font-mono text-xs underline underline-offset-4 hover:text-ink"
                href={`${config.explorer}/address/${config.contractAddress}`}
                target="_blank"
                rel="noreferrer"
              >
                {config.contractAddress}
              </a>
            </p>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
