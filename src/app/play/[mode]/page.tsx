import { notFound } from 'next/navigation';
import { Dive } from '@/components/Dive';

export const dynamic = 'force-dynamic';

export default function PlayPage({
  params,
  searchParams,
}: {
  params: { mode: string };
  searchParams: { s?: string };
}) {
  if (params.mode !== 'daily' && params.mode !== 'practice') notFound();
  return <Dive mode={params.mode} initialSessionId={searchParams.s ?? null} />;
}
