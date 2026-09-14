import WaitlistForm from '../../../components/WaitlistForm';
import { LOCK_YEARS } from '../../../lib/config';

export const metadata = { title: 'Get updates' };

export default function WaitlistPage() {
  return (
    <>
        <section id="waitlist" className="band band-cta">
          <div className="wrap waitwrap">
            <div>
              <p className="eyebrow">Stay informed</p>
              <h1 className="h1-page">Hear when it matters</h1>
              <p className="muted">
                Legacy Ladder is live on BNB Smart Chain, and its contracts have not been audited yet.
                Leave your email and we write only when something matters: an audit result, a DAO vote
                that needs depositors, or a risk you should know about. Connecting a wallet adds your
                address, which is how early contributors will be recognised.
              </p>
              <div className="risks">
                <p className="risks-head">Before you deposit, know this</p>
                <div className="risk">
                  <span className="m">01</span>
                  <div><b>One asset, no floor.</b> A pension fund spreads risk and often guarantees a
                    minimum. This does neither. An asset that fails takes the ladder with it.</div>
                </div>
                <div className="risk">
                  <span className="m">02</span>
                  <div><b>{LOCK_YEARS} years is a long time in this industry.</b> Contract, staking and
                    slashing risk all pass through to you for the full term.</div>
                </div>
                <div className="risk">
                  <span className="m">03</span>
                  <div><b>Your key is the only key.</b> There is no recovery and no beneficiary
                    register. Lose it and the ladder is orphaned.</div>
                </div>
              </div>
            </div>
            <WaitlistForm />
          </div>
        </section>
    </>
  );
}
