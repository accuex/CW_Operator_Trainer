import CWTrainer from '../../CWTrainer';
import { APP_VIEWS, type AppView } from '@/lib/appPaths';

export default async function TrainerPage({ params }: { params: Promise<{ view?: string[] }> }) {
  const { view } = await params;
  const section = view?.[0];
  const initialView = section && (APP_VIEWS as readonly string[]).includes(section) ? (section as AppView) : 'home';
  return <CWTrainer initialView={initialView} />;
}
