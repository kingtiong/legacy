import Link from 'next/link';
import { cookies } from 'next/headers';
import RememberQuestion from '../../components/RememberQuestion';
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
        <div className="ask-cta">
          <Link className="btn lg" href="/story">See what happened to those who kept it</Link>
          <Link className="ask-link" href="/how-it-works">How Decadium works <span aria-hidden="true">&rarr;</span></Link>
        </div>
      </div>
      <RememberQuestion index={index} />
    </section>
  );
}
