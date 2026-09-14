'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { bsc, mainnet } from 'wagmi/chains';
import { injected, mock } from '@wagmi/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RPC_URL, E2E_ACCOUNT } from '../lib/protocol';

const connectors = E2E_ACCOUNT
  ? [mock({ accounts: [E2E_ACCOUNT], features: { defaultConnected: true, reconnect: true } })]
  : [injected()];

// The test wallet sends transactions to the chain's default RPC, so in test mode that must be the local fork.
const chain = E2E_ACCOUNT ? { ...bsc, rpcUrls: { default: { http: [RPC_URL] } } } : bsc;

const wagmiConfig = createConfig({
  chains: [chain, mainnet],
  connectors,
  transports: {
    [chain.id]: http(RPC_URL),
    [mainnet.id]: http(),
  },
  ssr: true,
});

export default function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
