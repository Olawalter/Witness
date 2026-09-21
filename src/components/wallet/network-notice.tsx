"use client";

import { useDeployment } from "@/hooks/use-witness";
import { configResult } from "@/lib/genlayer/config";
import { useWallet } from "@/lib/wallet/wallet";

/**
 * Two blocking notices, stated plainly: a wallet on the wrong network, and a
 * configured address that is not a WITNESS deployment. Switching is offered as
 * a button the person presses; nothing switches on its own.
 */
export function NetworkNotice() {
  const wallet = useWallet();
  const deployment = useDeployment();
  if (!configResult.ok) return null;
  const { chainId, networkName } = configResult.config;
  const wrongNetwork = wallet.status === "connected" && wallet.chainId !== undefined && wallet.chainId !== chainId;
  const badDeployment = deployment.data && !deployment.data.ok ? deployment.data.reason : null;

  if (!wrongNetwork && !badDeployment) return null;

  return (
    <div role="alert" className="border-b border-rule bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-3 text-sm sm:px-8">
        {badDeployment ? (
          <p>
            <strong className="font-medium text-not-fulfilled">
              This app is not connected to a verified WITNESS contract.
            </strong>{" "}
            <span className="text-muted">{badDeployment} No transaction will be sent.</span>
          </p>
        ) : null}
        {wrongNetwork ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <strong className="font-medium">Your wallet is on another network.</strong>
            <span className="text-muted">
              WITNESS runs on {networkName}, chain {chainId}. Your wallet reports chain {wallet.chainId}.
            </span>
            <button type="button" className="border border-ink px-2.5 py-1 text-xs hover:bg-ink hover:text-paper" onClick={wallet.switchNetwork}>
              Switch network
            </button>
            {wallet.error ? <span className="text-not-fulfilled">{wallet.error}</span> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
