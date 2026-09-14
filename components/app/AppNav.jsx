'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ConnectButton from '../ConnectButton';
import { LIVE } from '../../lib/protocol';

const TABS = [
  ['/app', 'My ladder'],
  ['/app/deposit', 'Deposit'],
  ['/app/market', 'Market'],
  ['/app/dao', 'DAO'],
];

export default function AppNav() {
  const pathname = usePathname();
  return (
    <div className="appnav">
      <div className="wrap appnav-inner">
        <nav aria-label="App" className="appnav-tabs">
          {TABS.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        {LIVE && <ConnectButton size="sm" />}
      </div>
    </div>
  );
}
