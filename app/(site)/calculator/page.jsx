import Link from 'next/link';
import Calculator from '../../../components/Calculator';

export const metadata = { title: 'Calculator' };

export default function CalculatorPage() {
  return (
    <>
      <section className="page-head">
        <div className="wrap">
          <p className="eyebrow">Calculator</p>
          <h1>What a monthly habit builds</h1>
          <p className="lead">
            Change the numbers. Growth is the assumption that matters most, and the one nobody can
            promise you.
          </p>
        </div>
      </section>
      <section className="band band-alt band-tight">
        <div className="wrap">
          <Calculator />
        </div>
      </section>
      <section className="band next-step">
        <div className="wrap">
          <h2>The numbers only work if the coins are still there.</h2>
          <div className="cta">
            <Link className="btn lg" href="/story">See what happened to those who kept them</Link>
            <Link className="btn ghost lg" href="/waitlist">Join the waitlist</Link>
          </div>
        </div>
      </section>
    </>
  );
}
