"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { readClient, writeClient, type GenLayerClient } from "@/lib/genlayer/client";
import { configResult, type AppConfig } from "@/lib/genlayer/config";
import { initialTx, runWrite, type TxState } from "@/lib/genlayer/tx";
import { reads, validateDeployment, type Call, type DeploymentCheck } from "@/lib/contracts/witness";
import { useWallet } from "@/lib/wallet/wallet";
import type { Obligation, Page, ProofChain, ProtocolInfo } from "@/types/witness";

/** The configuration and a read-only client, built once. */
export function useWitness(): { config: AppConfig; client: GenLayerClient } {
  const value = useMemo(() => {
    if (!configResult.ok) throw new Error("WITNESS is not configured");
    return { config: configResult.config, client: readClient(configResult.config) };
  }, []);
  return value;
}

export type Query<T> = { data?: T; error?: Error; loading: boolean; reload: () => void };

type ReadState<T> = { key: string; data?: T; error?: Error };

/**
 * A read with its own loading and error states, so a page can say which of
 * "nothing yet" and "the read failed" is true. Loading is derived from whether
 * a result for the current key has arrived, so nothing sets state during
 * render or synchronously inside the effect.
 */
export function useRead<T>(key: string, run: (c: GenLayerClient, cfg: AppConfig) => Promise<T>,
                           options: { enabled?: boolean; pollMs?: number } = {}): Query<T> {
  const { client, config } = useWitness();
  const { enabled = true, pollMs } = options;
  const [nonce, setNonce] = useState(0);
  const [result, setResult] = useState<ReadState<T>>();
  const runRef = useRef(run);
  const readKey = `${key}#${nonce}`;

  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const value = await runRef.current(client, config);
        if (live) setResult({ key: readKey, data: value });
      } catch (err) {
        if (live) setResult({ key: readKey, error: err as Error });
      } finally {
        if (live && pollMs) timer = setTimeout(tick, pollMs);
      }
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
    // readKey identifies this read, and changes when reload() is called
  }, [client, config, readKey, enabled, pollMs]);

  const settled = result?.key === readKey ? result : undefined;
  return {
    data: settled?.data ?? (result?.data as T | undefined),
    error: settled?.error,
    loading: enabled && !settled,
    reload: useCallback(() => setNonce((n) => n + 1), []),
  };
}

export function useDeployment(): Query<DeploymentCheck> {
  return useRead("deployment", (c, cfg) => validateDeployment(c, cfg));
}

export function useProtocol(): Query<ProtocolInfo> {
  return useRead("protocol", (c, cfg) => reads.protocol(c, cfg));
}

export function useObligations(limit = 50): Query<Page<Obligation>> {
  return useRead(`obligations:${limit}`, (c, cfg) => reads.list(c, cfg, 0, limit));
}

export function useProofChain(id: string, pollMs?: number): Query<ProofChain> {
  return useRead(`chain:${id}`, (c, cfg) => reads.proofChain(c, cfg, id), { pollMs });
}

export function useMine(address?: string): Query<{ created: Page<Obligation>; responsible: Page<Obligation> }> {
  return useRead(
    `mine:${address ?? ""}`,
    async (c, cfg) => ({
      created: await reads.byCreator(c, cfg, address!),
      responsible: await reads.byResponsible(c, cfg, address!),
    }),
    { enabled: !!address },
  );
}

/** The browser clock in UTC seconds, ticking, for display and previews only. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ── writing ─────────────────────────────────────────────────────────────────

export type SendOptions = {
  call: Call;
  /** Resolves true once the contract's own view reflects the write. */
  reconciled: () => Promise<boolean | string>;
  onSettled?: () => void;
};

export type Sender = {
  state: TxState;
  busy: boolean;
  send: (options: SendOptions) => Promise<TxState>;
  reset: () => void;
};

/** One write at a time, with the transaction's own state machine. */
export function useSend(): Sender {
  const { config, client: reader } = useWitness();
  const wallet = useWallet();
  const deployment = useDeployment();
  const [state, setState] = useState<TxState>(initialTx);

  const send = useCallback(
    async ({ call, reconciled, onSettled }: SendOptions) => {
      const fail = (message: string) => {
        const next: TxState = { ...initialTx, stage: "FAILED", message };
        setState(next);
        return next;
      };
      if (wallet.status !== "connected" || !wallet.account || !wallet.provider) {
        return fail("Connect a wallet first.");
      }
      if (wallet.chainId !== config.chainId) {
        return fail(`Your wallet is on another network. Switch it to ${config.networkName} and try again.`);
      }
      if (deployment.data && !deployment.data.ok) {
        return fail("The configured contract is not verified as WITNESS, so nothing was sent.");
      }
      const final = await runWrite({
        config,
        client: writeClient(config, wallet.account, wallet.provider),
        functionName: call.functionName,
        args: call.args,
        value: call.value,
        reconciled,
        poller: reader,
        onUpdate: setState,
      });
      onSettled?.();
      return final;
    },
    [config, deployment.data, reader, wallet.account, wallet.chainId, wallet.provider, wallet.status],
  );

  const busy = state.stage !== "READY" && state.stage !== "FAILED" && state.stage !== "FINALIZED" && state.stage !== "DECIDED";

  return { state, busy, send, reset: useCallback(() => setState(initialTx), []) };
}
