import { notFound } from 'next/navigation';
import { PileupLab } from './PileupLab';

/** Stage 2.5 calibration only: playing the pileup engine by ear. Not part of the app. */
export default function PileupLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PileupLab />;
}
