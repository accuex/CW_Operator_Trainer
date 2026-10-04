import CWTrainer from '../CWTrainer';

const valid = ['learn','train','levelup','queue','analysis','exam','collection','settings','account'] as const;
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  const initialView = valid.includes(section as typeof valid[number]) ? section as typeof valid[number] : 'home';
  return <CWTrainer initialView={initialView} />;
}
