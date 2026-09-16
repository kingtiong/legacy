import './globals.css';
import Providers from './providers';
import { NAME, TAGLINE, SITE_URL } from '../lib/config';

// Bump after re-rendering public/og.png (og/render.sh). Apps cache previews by
// URL, so a new query string is what makes them fetch the new image.
const OG_VERSION = 3;
const DESCRIPTION =
  'Deposit BNB every month and lock each deposit for ten years while it earns staking rewards. From year eleven, each month’s deposit unlocks in turn. A time-locked savings protocol on BNB Smart Chain.';
const OG_IMAGE = {
  url: `${SITE_URL}/og.png?v=${OG_VERSION}`,
  width: 1200,
  height: 630,
  alt: `${NAME}: Where is the crypto you earned ten years ago? And how much of this year’s will still be yours in ten years?`,
};

export const metadata = {
  title: { default: `${NAME} — ${TAGLINE}`, template: `%s · ${NAME}` },
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: NAME,
    title: `${NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: `${NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Spectral:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
