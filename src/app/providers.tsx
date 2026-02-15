// calibra/src/app/providers.tsx
"use client";

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

const ADI_RPC = "https://rpc.ab.testnet.adifoundation.ai/";

const adiTestnet = {
  id: 99999,
  name: "ADI Testnet",
  network: "adi-testnet",
  nativeCurrency: {
    name: "ADI",
    symbol: "ADI",
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [ADI_RPC] },
    public: { http: [ADI_RPC] },
  },
  blockExplorers: {
    default: {
      name: "Explorer",
      url: "https://explorer.ab.testnet.adifoundation.ai/",
    },
  },
  testnet: true,
} as const;

const config = createConfig({
  ssr: false,
  chains: [adiTestnet],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [adiTestnet.id]: http(ADI_RPC),
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
