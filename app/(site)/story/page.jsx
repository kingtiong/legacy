import Link from 'next/link';
import HoldGame from '../../../components/HoldGame';
import { NAME } from '../../../lib/config';
import { PROTECTS } from '../../../lib/content';
import { STORIES, SOURCES } from '../../../lib/history';
import { getTodayPrices } from '../../../lib/prices';
import { aboutUsd, multiple } from '../../../lib/format';

// Rebuilt at most hourly so "today" prices stay current.
export const revalidate = 3600;
export const metadata = { title: 'The story' };

export default async function StoryPage() {
  const today = await getTodayPrices();
  const eth = STORIES.eth;
  const bnb = STORIES.bnb;
  const ethThen = eth.entry.price * eth.coins;
  const ethNow = today.eth * eth.coins;
  const bnbThen = bnb.entry.price * bnb.coins;
  const bnbNow = today.bnb * bnb.coins;
  const asOf = new Date(today.asOf).toISOString().slice(0, 16).replace('T', ' ');

  return (
    <>
        <section className="page-head">
          <div className="wrap">
            <p className="eyebrow">The story</p>
            <h1>
              In 2016, 10&nbsp;ETH cost about&nbsp;{aboutUsd(ethThen)}.{' '}
              <em>Held, it&rsquo;s worth {aboutUsd(ethNow)} today.</em>
            </h1>
            <p className="lead">The coins were never the hard part. Keeping them was. These are real past prices, not a forecast.</p>
          </div>
        </section>

        <section className="thennow">
          <div className="wrap">
            <div className="tn-grid">
              {[
                [eth, ethThen, ethNow, today.eth],
                [bnb, bnbThen, bnbNow, today.bnb],
              ].map(([st, then, now, px]) => (
                <div className="tn-card" key={st.key}>
                  <span className="tn-coins">{st.coins} {st.symbol}</span>
                  <div className="tn-row">
                    <div>
                      <span className="tn-k">{st.entry.label}</span>
                      <span className="tn-then tnum">{aboutUsd(then)}</span>
                    </div>
                    <span className="tn-arrow" aria-hidden="true">&rarr;</span>
                    <div>
                      <span className="tn-k">Today, if never sold</span>
                      <span className="tn-now tnum">{aboutUsd(now)}</span>
                    </div>
                  </div>
                  <span className="tn-mult">{multiple(now, then)} &middot; {st.symbol} at ${px.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  <p className="tn-note">{st.maturity}</p>
                </div>
              ))}
            </div>
            <p className="tn-caveat">
              <b>These are the survivors.</b> Plenty of coins bought in 2017 are worth nothing today. A
              lock stops you selling a winner; it cannot turn a loser into one. {SOURCES} Prices as of{' '}
              {asOf} UTC{today.live ? '' : ' (stored, live prices unavailable)'}.
            </p>
          </div>
        </section>

        <section id="held" className="band band-alt">
          <div className="wrap">
            <div className="sec-head">
              <p className="eyebrow">The real test</p>
              <h2>Would you have held?</h2>
              <p className="muted">
                The price chart only shows what the coins did. It hides the part that matters: every
                crash asked you to sell, and every rally asked you to spend. Here are five real moments.
                It only takes one wrong answer.
              </p>
            </div>
            <HoldGame stories={STORIES} today={{ eth: today.eth, bnb: today.bnb }} />
          </div>
        </section>

        <section className="band">
          <div className="wrap protect">
            <div className="protect-head">
              <p className="eyebrow">Discipline, and protection</p>
              <p className="pull">
                You are not buying yield. <em>You are buying the inability to sell.</em>
              </p>
              <p className="muted">
                Countries make people pay into pension funds they can&rsquo;t touch for exactly this
                reason. If you&rsquo;re paid in crypto, nobody does that for you. {NAME} lets you do it
                for yourself, on purpose, once.
              </p>
            </div>
            <div className="protect-list">
              {PROTECTS.map(([t, b]) => (
                <div className="protect-item" key={t}>
                  <h3>{t}</h3>
                  <p>{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="band next-step">
          <div className="wrap">
            <h2>A lock makes the decision once, so you never have to make it again.</h2>
            <div className="cta">
              <Link className="btn lg" href="/how-it-works">See how it works</Link>
              <Link className="btn ghost lg" href="/waitlist">Join the waitlist</Link>
            </div>
          </div>
        </section>
    </>
  );
}
