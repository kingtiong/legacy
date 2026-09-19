import { notFound } from 'next/navigation';
import { FeedbackPage } from '../../../components/FeedbackForm';
import { TEST_MODE } from '../../../lib/protocol';

export const metadata = { title: 'Report a problem' };

// Test edition only: where testers report how deposits, claims and withdrawals went.
export default function Feedback() {
  if (!TEST_MODE) notFound();
  return <FeedbackPage />;
}
