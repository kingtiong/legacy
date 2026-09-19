import Link from 'next/link';
import SiteHeader from '../../components/SiteHeader';
import { PAGES } from '../../lib/pages';
import { NAME } from '../../lib/config';
import { LIVE, DEPOSITS_PAUSED, TEST_MODE, BASE_PATH } from '../../lib/protocol';

export default function SiteLayout({ children }) {
  return (
    <>
      <SiteHeader />
      <main id="top">{children}</main>
      <footer>
        <div className="wrap inner">
          <Link className="brand small" href="/" aria-label={`${NAME} home`}>
            <img className="brand-logo" src={`${BASE_PATH}/brand/decadium-logo.png`} alt={`${NAME}: time is the strategy.`} width="1334" height="272" />
          </Link>
          <nav className="footnav" aria-label="Footer">
            {PAGES.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
          <span className="footnote">
            {TEST_MODE
              ? 'Test edition with a 10-hour lock. Not the Decadium product. Nothing here is financial advice.'
              : DEPOSITS_PAUSED
              ? 'Deposits paused for a security upgrade. Nothing here is financial advice.'
              : LIVE
              ? 'Live on BNB Smart Chain. Unaudited contracts. Nothing here is financial advice.'
              : 'Pre-launch. Nothing is deployed, and nothing here is financial advice.'}
          </span>
        </div>
      </footer>
    </>
  );
}
