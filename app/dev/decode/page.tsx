import { notFound } from 'next/navigation';
import { DecodeLab } from './DecodeLab';

/** DECODE QA only: the presets on the real rig, the decoder against what was keyed. Not part of the app. */
export default function DecodeLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DecodeLab />;
}
