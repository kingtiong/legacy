import Link from 'next/link';
import { FAQ } from '../../../lib/content';

export const metadata = { title: 'FAQ' };

export default function FaqPage() {
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Questions</p>
          <h1>The things people ask first</h1>
        </div>
      </section>
      <section className="band band-tight">
        <div className="wrap">
          <div className="faq faq-single">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}</summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <section className="band next-step">
        <div className="wrap">
          <h2>Still thinking about it? Good.</h2>
          <div className="cta">
            <Link className="btn lg" href="/waitlist">Join the waitlist</Link>
            <Link className="btn ghost lg" href="/story">Read the story</Link>
          </div>
        </div>
      </section>
    </>
  );
}
