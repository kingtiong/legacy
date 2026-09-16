import AppNav from '../../../components/app/AppNav';
import { LIVE, DEPOSITS_PAUSED, VAULT_ADDRESS, MARKET_ADDRESS, GOVERNOR_ADDRESS, TREASURY_ADDRESS, EXPLORER } from '../../../lib/protocol';

export default function AppLayout({ children }) {
  return (
    <>
      <AppNav />
      <div className="wrap appbody">
        {DEPOSITS_PAUSED && (
          <p className="formmsg err app-banner" role="status">
            Deposits are paused for a security upgrade. No deposits have been made and no funds are affected.
          </p>
        )}
        {children}
        {LIVE && (
          <p className="app-foot">
            Unaudited contracts, no owner, no upgrade. Vault{' '}
            <a href={`${EXPLORER}/address/${VAULT_ADDRESS}`} target="_blank" rel="noreferrer">{VAULT_ADDRESS.slice(0, 10)}…</a>
            {' · '}Market{' '}
            <a href={`${EXPLORER}/address/${MARKET_ADDRESS}`} target="_blank" rel="noreferrer">{MARKET_ADDRESS.slice(0, 10)}…</a>
            {' · '}DAO{' '}
            <a href={`${EXPLORER}/address/${GOVERNOR_ADDRESS}`} target="_blank" rel="noreferrer">{GOVERNOR_ADDRESS.slice(0, 10)}…</a>
            {' · '}Treasury{' '}
            <a href={`${EXPLORER}/address/${TREASURY_ADDRESS}`} target="_blank" rel="noreferrer">{TREASURY_ADDRESS.slice(0, 10)}…</a>
            {' · '}
            <a href="https://github.com/kingtiong/legacy" target="_blank" rel="noreferrer">Source</a>
          </p>
        )}
      </div>
    </>
  );
}
