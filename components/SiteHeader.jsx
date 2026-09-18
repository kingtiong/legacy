'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NAME } from '../lib/config';
import { PAGES } from '../lib/pages';


export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const button = useRef(null);
  const header = useRef(null);

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onPointer = (e) => { if (!header.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <>
    <header ref={header} className={`topbar${open ? ' is-open' : ''}`}>
      <div className="wrap inner">
        <Link className="brand" href="/" aria-label={`${NAME} home`}>
          <img className="brand-logo" src="/brand/decadium-wordmark.png" alt={NAME} width="1334" height="180" />
        </Link>
        <button ref={button} type="button" className="menu-btn" aria-expanded={open} aria-controls="site-menu"
          onClick={() => setOpen((v) => !v)}>
          <span className="menu-icon" aria-hidden="true"><i /><i /></span>
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      <nav id="site-menu" className="menu-panel" hidden={!open} aria-label="Site">
        <div className="wrap">
          <ul>
            {PAGES.map(([href, label, note]) => (
              <li key={href}>
                <Link href={href} aria-current={pathname === href ? 'page' : undefined} onClick={() => setOpen(false)}>
                  <span className="menu-label">{label}</span>
                  <span className="menu-note">{note}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </nav>
    </header>
    {/* Outside the header: its backdrop-filter would trap a fixed-position overlay. */}
    {open && <div className="menu-scrim" aria-hidden="true" />}
    </>
  );
}
