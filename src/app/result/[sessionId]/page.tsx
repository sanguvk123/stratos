import { ResultView } from '@/components/ResultView';

export const dynamic = 'force-dynamic';

export default function ResultPage({ params }: { params: { sessionId: string } }) {
  return <ResultView sessionId={params.sessionId} />;
}
