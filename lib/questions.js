// The home page asks one of these per visit, in rotation. Each is a question and
// a quieter follow-up. `year` is ten years from today.
export const QUESTIONS = [
  {
    q: 'Where is the crypto you earned ten years ago?',
    follow: (year) => `And how much of what you earn this year will still be yours in ${year}?`,
  },
  {
    q: 'How much crypto will be left in your wallet ten years from now?',
    follow: () => 'Not what it will be worth. How much of it will still be there.',
  },
  {
    q: 'Will any of this year’s crypto still be yours in ten years?',
    follow: () => 'Or will a crash, a rally, or one bad week decide for you?',
  },
  {
    q: 'What happened to the first crypto you ever owned?',
    follow: () => 'And what will happen to the crypto you earn this year?',
  },
  {
    q: 'If you had never sold, what would your wallet hold today?',
    follow: () => 'The coins did their part. The hard part was holding on.',
  },
  {
    q: 'Who decides when your crypto gets sold: you, or your worst week?',
    follow: (year) => `Between now and ${year} there will be a lot of weeks.`,
  },
];

export const QUESTION_COOKIE = 'll_q';

// Next question after the one this visitor saw last; a random one on a first visit.
export function nextQuestionIndex(last) {
  const n = QUESTIONS.length;
  const i = Number.parseInt(last, 10);
  return Number.isInteger(i) && i >= 0 && i < n ? (i + 1) % n : Math.floor(Math.random() * n);
}
