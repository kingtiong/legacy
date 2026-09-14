'use client';

import { WagmiProvider, createConfig, http } from 'wagmi';
import { bsc, mainnet } from 'wagmi/chains';
import { injected } from '@wagmi/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

const wagmiConfig = createConfig({
  chains: [bsc, mainnet],
  connectors: [injected()],
  transports: {
    [bsc.id]: http(),
    [mainnet.id]: http(),
  },
  ssr: true,
});

export default function Providers({ children }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
