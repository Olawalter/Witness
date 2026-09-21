"use client";

import { useEffect, useRef, useState } from "react";

import { shortAddress } from "@/lib/formatting/present";
import { useWallet } from "@/lib/wallet/wallet";

/** Connect, disconnect, and the wallet chooser. Wallets are listed by the name
 * each one announces through EIP-6963. */
export function WalletButton() {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  if (wallet.status === "connected" && wallet.account) {
    return (
      <div className="flex items-center gap-2">
        <span className="figure text-xs" title={wallet.account}>
          {shortAddress(wallet.account)}
        </span>
        <button
          type="button"
          className="border border-rule px-2.5 py-1.5 text-xs hover:border-ink"
          onClick={wallet.disconnect}
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="bg-ink px-3.5 py-2 text-sm font-medium text-paper hover:bg-amber-deep disabled:opacity-60"
        disabled={wallet.status === "connecting"}
        onClick={() => setOpen(true)}
      >
        {wallet.status === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>

      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        className="m-auto w-[min(420px,92vw)] border border-ink bg-paper p-0 text-ink backdrop:bg-ink/40"
        aria-label="Connect a wallet"
      >
        <div className="grid gap-4 p-5">
          <div className="grid gap-1">
            <h2 className="text-xl">Connect a wallet</h2>
            <p className="text-sm text-muted">
              WITNESS signs with your own browser wallet. It never asks for, sees or stores a private key.
            </p>
          </div>
          {wallet.wallets.length === 0 ? (
            <p className="border border-rule bg-surface p-4 text-sm text-muted">
              No browser wallet was found. Install MetaMask, Rabby, Trust Wallet or another injected wallet, then reload
              this page.
            </p>
          ) : (
            <ul className="grid gap-2">
              {wallet.wallets.map((w) => (
                <li key={w.info.uuid}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 border border-rule bg-surface px-4 py-3 text-left text-sm hover:border-ink"
                    onClick={async () => {
                      await wallet.connect(w);
                      setOpen(false);
                    }}
                  >
                    {w.info.icon ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={w.info.icon} alt="" className="h-6 w-6" />
                    ) : (
                      <span className="h-6 w-6 border border-rule" aria-hidden="true" />
                    )}
                    <span>{w.info.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {wallet.error ? <p className="text-sm text-not-fulfilled">{wallet.error}</p> : null}
          <button type="button" className="justify-self-start text-sm underline underline-offset-4" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
