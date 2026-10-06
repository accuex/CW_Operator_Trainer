import { notFound, redirect } from 'next/navigation';
import { APP_VIEWS, viewToPath, type AppView } from '@/lib/appPaths';

/** Old root paths (`/learn`, `/qso`, …) send people into `/app/*`. */
export default async function LegacyTrainerPath({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (section === 'home' || !(APP_VIEWS as readonly string[]).includes(section)) notFound();
  redirect(viewToPath(section as AppView));
}
