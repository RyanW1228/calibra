// calibra/src/app/providers.tsx
"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";

const queryClient = new QueryClient();

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
    default: {
      http: ["https://rpc.ab.testnet.adifoundation.ai/"],
    },
    public: {
      http: ["https://rpc.ab.testnet.adifoundation.ai/"],
    },
  },
};

const config = createConfig({
  chains: [adiTestnet],
  connectors: [injected()],
  transports: {
    [adiTestnet.id]: http(),
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
