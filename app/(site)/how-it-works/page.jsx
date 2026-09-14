import Link from 'next/link';
import HeroLadder from '../../../components/HeroLadder';
import { NAME, LOCK_YEARS, BUCKET_A_PCT, BUCKET_B_PCT } from '../../../lib/config';
import { STEPS, NEVER, FOR, ROADMAP } from '../../../lib/content';

export const metadata = { title: 'How it works' };

const START_YEAR = new Date().getUTCFullYear();

export default function HowItWorksPage() {
  return (
    <>
        <section className="page-head">
          <div className="wrap hero-grid">
            <div>
              <p className="eyebrow">How it works</p>
              <h1>Lock a slice of every month. <em>Get it back, every month.</em></h1>
              <p className="lead">
                Each month&rsquo;s deposit becomes one rung of a ladder, locked for {LOCK_YEARS} years and
                staked while it waits. Keep it up and, from year eleven, one rung matures every month.
              </p>
            </div>
            <HeroLadder startYear={START_YEAR} />
          </div>
        </section>

        <section id="how" className="band">
          <div className="wrap">
            <div className="sec-head">
              <p className="eyebrow">How it works</p>
              <h2>The life of one rung</h2>
              <p className="muted">Every deposit you make goes through the same four stages.</p>
            </div>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li className="step" key={s.title}>
                  <span className="step-n tnum">{i + 1}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="band">
          <div className="wrap buckets-wrap">
            <div className="sec-head">
              <p className="eyebrow">Structure</p>
              <h2>Every deposit splits in two</h2>
              <p className="muted">
                Retirement schemes keep part of your money reachable for emergencies and the rest out
                of reach. Your deposits split the same way, permanently, the moment they land.
              </p>
            </div>
            <div>
              <div className="splitbar">
                <div className="a"><b>{BUCKET_A_PCT}%</b> Retirement</div>
                <div className="b"><b>{BUCKET_B_PCT}%</b> Emergency</div>
              </div>
              <div className="splitnotes">
                <div className="splitnote">
                  <b>Bucket A &middot; Retirement</b>
                  Cannot be sold, transferred or withdrawn. It matures after {LOCK_YEARS} years and not
                  a day before. No fee unlocks it, because none exists.
                </div>
                <div className="splitnote b">
                  <b>Bucket B &middot; Emergency</b>
                  Can be sold to another person for stablecoin, at whatever price they will pay to wait
                  out the rest of your lock. It can be sold, but never withdrawn early.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="band band-alt">
          <div className="wrap">
            <div className="sec-head">
              <p className="eyebrow">By design</p>
              <h2>What {NAME} will never do</h2>
              <p className="muted">A savings protocol should be boring. These are the lines it is designed not to cross.</p>
            </div>
            <div className="never">
              {NEVER.map(([t, b]) => (
                <div className="never-item" key={t}>
                  <span className="never-tag">Never</span>
                  <h3>{t}</h3>
                  <p>{b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="band">
          <div className="wrap">
            <div className="sec-head">
              <p className="eyebrow">Who it&rsquo;s for</p>
              <h2>Built for income that arrives in crypto</h2>
            </div>
            <div className="for">
              {FOR.map(([t, b]) => (
                <div className="for-item" key={t}>
                  <h3>{t}</h3>
                  <p>{b}</p>
                </div>
              ))}
            </div>
            <p className="for-note">Designed for 1&ndash;10% of what you earn. Not for all of it.</p>
          </div>
        </section>

        <section className="band band-alt">
          <div className="wrap road-wrap">
            <div className="sec-head">
              <p className="eyebrow">Road to launch</p>
              <h2>Where things stand</h2>
              <p className="muted">
                Nothing takes a deposit until the contracts have been independently audited. No dates
                are promised here, because good audits don&rsquo;t run to a marketing calendar.
              </p>
            </div>
            <ol className="road">
              {ROADMAP.map(([t, b, state, label]) => (
                <li className={`road-item is-${state}`} key={t}>
                  <span className="road-dot" aria-hidden="true" />
                  <div>
                    <h3>{t} <span className={`pill pill-${state}`}>{label}</span></h3>
                    <p>{b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="band next-step">
          <div className="wrap">
            <h2>Run your own numbers.</h2>
            <div className="cta">
              <Link className="btn lg" href="/calculator">Open the calculator</Link>
              <Link className="btn ghost lg" href="/waitlist">Get updates</Link>
            </div>
          </div>
        </section>
    </>
  );
}
