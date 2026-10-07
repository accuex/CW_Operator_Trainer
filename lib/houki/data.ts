export const BUNDLES = ['distress', 'license', 'watch', 'operator'] as const;
export type Bundle = (typeof BUNDLES)[number];
export interface HoukiItem {
  id: string; kind: 'judge' | 'pick'; points: 1 | 5; bundle: Bundle;
  law: string; title: string; prompt: string; answer: string; options: string[];
  learningClause: string; correction: string;
  sourceEvidence: { legacyId: string; sourceExam: { exam: string; question: string }; sourceStatementRef: string; sourceJudgement: string }[];
  legalBasis: { law: string; lawId: string; article: string; paragraph: number; item: string | null; url: string };
  verification: { status: 'verified'; date: string; source: string; revisionId: string; evidenceSha256: string; evidence: string; additionalEvidence: string[] };
  optionAssessments: { option: string; correct: boolean; reason: string }[];
}
export interface HoukiGroup { id: Bundle; title: string; goal: string }
export interface HoukiMaster {
  schemaVersion: 2; masterVersion: string; referenceDate: string; blockPoint: 25;
  groups: HoukiGroup[]; items: HoukiItem[];
}
export function validateMaster(master: HoukiMaster): HoukiMaster {
  if (master.schemaVersion !== 2 || master.blockPoint !== 25 || !master.items?.length || !master.groups?.length) throw Error('教材の形式を確認できません');
  const ids = new Set<string>();
  for (const item of master.items) {
    if (ids.has(item.id) || !item.id.startsWith('houki-') || item.verification?.status !== 'verified'
      || item.verification.date !== master.referenceDate || !item.learningClause || !item.legalBasis?.article
      || !master.groups.some(g => g.id === item.bundle) || item.points !== (item.kind === 'judge' ? 1 : 5)
      || new Set(item.options).size !== item.options.length || !item.options.includes(item.answer)
      || item.optionAssessments.filter(o => o.correct).length !== 1
      || item.optionAssessments.find(o => o.correct)?.option !== item.answer) throw Error('教材の確認状態を読み込めません');
    ids.add(item.id);
  }
  return master;
}
let cached: Promise<HoukiMaster> | undefined;
export function loadHoukiMaster(): Promise<HoukiMaster> {
  cached ??= fetch('/houki/data/houki-phrases-v2.json').then(async response => {
    if (!response.ok) throw Error('教材の読み込みに失敗しました');
    return validateMaster(await response.json());
  }).catch(error => { cached = undefined; throw error; });
  return cached;
}
