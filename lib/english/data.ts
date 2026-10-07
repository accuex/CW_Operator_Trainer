export type Tier = 'minimum' | 'standard' | 'extended';
export const TIERS: Tier[] = ['minimum', 'standard', 'extended'];
export const TIER_LABELS: Record<Tier, string> = { minimum: '最小', standard: '標準', extended: 'しっかり' };
export interface Evidence { e0_occurrence_id: string; e0_unit_id: string; source: string; exam_date: string; question_number: number; subquestion: string | null; page_start: number; reading_or_listening: string; role_in_E0: string; verification: string }
export interface EnglishItem {
  learningEntityId: string; term: string; normalized_term: string;
  category: 'CORE' | 'CONTEXT' | 'SCENE' | 'LEGAL' | 'EXTRA'; tier: Tier; learning_groups: string[];
  general_meaning: string | null; specialized_meaning: string; misleading_meanings: string;
  example: { english: string; japanese: string; source: string };
  japanese_explanation: string; why_it_matters: string;
  modality: { recommended: 'reading' | 'listening' | 'both'; basis: string; audio_checked: boolean };
  meaning_impact: string; e0_frequency_facts: { occurrence_count: number; stem_years: number[]; stem_exam_dates: string[] };
  evidence_references: Evidence[]; related_terms: string[];
  supplements: { term_id: string; term: string; meaning: string }[];
  legal_structure: { label: string; text: string }[]; evidence_role_note?: string; supplement_modality_note?: string;
}
export interface EnglishMaster { schemaVersion: 1; masterVersion: string; tier_counts: Record<Tier, number>; groups: { id: string; title: string; goal: string }[]; frequency_definition: string; modality_definition: string; example_definition: string; impact_scale: Record<string, string>; items: EnglishItem[] }
export function selectedItems(master: EnglishMaster, tier: Tier, group: string) {
  const allowed = TIERS.slice(0, TIERS.indexOf(tier) + 1);
  return master.items.filter(item => allowed.includes(item.tier) && (group === 'all' || item.learning_groups.includes(group)));
}
let cached: Promise<EnglishMaster> | undefined;
export function loadEnglishMaster(): Promise<EnglishMaster> {
  cached ??= fetch('/english/data/english-learning-master-v1.json').then(async response => {
    if (!response.ok) throw Error('教材の読み込みに失敗しました');
    const master = await response.json() as EnglishMaster;
    if (master.schemaVersion !== 1 || !Array.isArray(master.items) || !master.groups?.length) throw Error('教材の形式を確認できません');
    return master;
  }).catch(error => { cached = undefined; throw error; });
  return cached;
}
