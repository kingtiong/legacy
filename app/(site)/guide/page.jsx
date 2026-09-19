import { notFound } from 'next/navigation';
import TesterGuide from '../../../components/TesterGuide';
import { TEST_MODE } from '../../../lib/protocol';

export const metadata = { title: 'How to test' };

// Only the ten-hour test edition has a tester guide.
export default function GuidePage() {
  if (!TEST_MODE) notFound();
  return <TesterGuide />;
}
