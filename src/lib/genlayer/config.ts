/**
 * Public configuration, validated once at import. The app refuses to run
 * against a network or contract it cannot name: a missing or malformed value
 * renders a configuration page instead of a half-working interface.
 *
 *   NEXT_PUBLIC_GENLAYER_NETWORK   studionet
 *   NEXT_PUBLIC_GENLAYER_CHAIN     61999, GenLayer StudioNet's chain id
 *   NEXT_PUBLIC_GENLAYER_RPC_URL   optional; defaults to StudioNet's RPC
 *   NEXT_PUBLIC_WITNESS_CONTRACT   the deployed WITNESS Intelligent Contract
 *
 * Nothing secret belongs here: every NEXT_PUBLIC_* value is shipped to the
 * browser. WITNESS has no server-side key and no backend.
 */

export const NETWORKS = {
  studionet: {
    chainId: 61999,
    name: "GenLayer StudioNet",
    rpcUrl: "https://studio.genlayer.com/api",
    explorer: "https://explorer-studio.genlayer.com",
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

export type AppConfig = {
  network: NetworkName;
  networkName: string;
  chainId: number;
  rpcUrl: string;
  explorer: string;
  contractAddress: `0x${string}`;
};

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; problems: string[] };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function parseConfig(env: Record<string, string | undefined>): ConfigResult {
  const problems: string[] = [];

  const networkName = (env.NEXT_PUBLIC_GENLAYER_NETWORK || "").trim();
  const network = (networkName in NETWORKS ? networkName : "") as NetworkName | "";
  if (!network) problems.push("NEXT_PUBLIC_GENLAYER_NETWORK must be studionet");

  const chainRaw = (env.NEXT_PUBLIC_GENLAYER_CHAIN || "").trim();
  const chainId = Number(chainRaw);
  if (!chainRaw || !Number.isInteger(chainId)) {
    problems.push("NEXT_PUBLIC_GENLAYER_CHAIN must be a number");
  } else if (network && chainId !== NETWORKS[network].chainId) {
    problems.push(`NEXT_PUBLIC_GENLAYER_CHAIN must be ${NETWORKS[network].chainId} for ${NETWORKS[network].name}`);
  }

  const rpcUrl = (env.NEXT_PUBLIC_GENLAYER_RPC_URL || "").trim();
  if (rpcUrl && !rpcUrl.startsWith("https://")) {
    problems.push("NEXT_PUBLIC_GENLAYER_RPC_URL must use https");
  }

  const contractAddress = (env.NEXT_PUBLIC_WITNESS_CONTRACT || "").trim();
  if (!contractAddress) {
    problems.push("NEXT_PUBLIC_WITNESS_CONTRACT is not set");
  } else if (!ADDRESS.test(contractAddress)) {
    problems.push("NEXT_PUBLIC_WITNESS_CONTRACT must be a 20-byte hex address");
  } else if (/^0x0{40}$/.test(contractAddress)) {
    problems.push("NEXT_PUBLIC_WITNESS_CONTRACT cannot be the zero address");
  }

  if (problems.length || !network) return { ok: false, problems };
  const net = NETWORKS[network];
  return {
    ok: true,
    config: {
      network,
      networkName: net.name,
      chainId,
      rpcUrl: rpcUrl || net.rpcUrl,
      explorer: net.explorer,
      contractAddress: contractAddress as `0x${string}`,
    },
  };
}

// Next inlines NEXT_PUBLIC_* only where each is referenced by its full name.
export const configResult = parseConfig({
  NEXT_PUBLIC_GENLAYER_NETWORK: process.env.NEXT_PUBLIC_GENLAYER_NETWORK,
  NEXT_PUBLIC_GENLAYER_CHAIN: process.env.NEXT_PUBLIC_GENLAYER_CHAIN,
  NEXT_PUBLIC_GENLAYER_RPC_URL: process.env.NEXT_PUBLIC_GENLAYER_RPC_URL,
  NEXT_PUBLIC_WITNESS_CONTRACT: process.env.NEXT_PUBLIC_WITNESS_CONTRACT,
});
