import Link from 'next/link';
import SiteHeader from '../../components/SiteHeader';
import { PAGES } from '../../lib/pages';
import { NAME } from '../../lib/config';
import { LIVE, DEPOSITS_PAUSED } from '../../lib/protocol';

export default function SiteLayout({ children }) {
  return (
    <>
      <SiteHeader />
      <main id="top">{children}</main>
      <footer>
        <div className="wrap inner">
          <Link className="brand small" href="/">
            <span className="rungs" aria-hidden="true"><i /><i /><i /></span>
            {NAME}
          </Link>
          <nav className="footnav" aria-label="Footer">
            {PAGES.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}
          </nav>
          <span className="footnote">
            {DEPOSITS_PAUSED
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
