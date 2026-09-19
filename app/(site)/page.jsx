import Link from 'next/link';
import { cookies } from 'next/headers';
import RememberQuestion from '../../components/RememberQuestion';
import { TEST_MODE } from '../../lib/protocol';
import { QUESTIONS, QUESTION_COOKIE, nextQuestionIndex } from '../../lib/questions';

// The front door asks one question and nothing else, and a different one on each
// visit. Reading the cookie makes this page render per request, so it is never cached.
export default async function Home() {
  const index = nextQuestionIndex((await cookies()).get(QUESTION_COOKIE)?.value);
  const { q, follow } = QUESTIONS[index];
  const inTenYears = new Date().getUTCFullYear() + 10;

  // Keep the last two words together so the question mark never ends up alone.
  const words = q.slice(0, -1).split(' ');
  const tail = words.splice(-2).join('\u00a0');
  const head = words.join(' ');

  return (
    <section className="ask">
      <div className="wrap">
        <h1 className="ask-q">
          {head} {tail}<span className="ask-mark">?</span>
        </h1>
        <p className="ask-follow">{follow(inTenYears)}</p>
        {TEST_MODE && (
          <div className="ask-cta">
            <Link className="btn lg" href="/app/deposit">Try it: make a test deposit</Link>
            <span className="muted small">Locked for 10 hours, then back to your wallet.</span>
          </div>
        )}
        <div className="ask-cta">
          <Link className={TEST_MODE ? 'btn ghost lg' : 'btn lg'} href="/story">See what happened to those who kept it</Link>
          <Link className="ask-link" href="/how-it-works">How Decadium works <span aria-hidden="true">&rarr;</span></Link>
        </div>
      </div>
      <RememberQuestion index={index} />
    </section>
  );
}
