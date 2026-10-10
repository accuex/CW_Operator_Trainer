import type { IconName } from '@/app/components/icons';
import { MorseAudioEngine } from '@/lib/audio';
import type { MorseCard } from '@/lib/morse';
import { normalizeKinds, scopeSetLabel, type CharacterKind } from '@/lib/course';
import { readProgressMeter } from '@/lib/progressMeter';
import type { CardProgress, TrainerProfile } from '@/lib/types';
import type { AppView } from '@/lib/appPaths';

export type View = AppView;
export { pathToView, viewToPath, APP_BASE } from '@/lib/appPaths';
export type QueueSource = 'international' | 'wabun' | 'visual' | 'phonetic' | 'digits' | 'kana';
export interface ViewMeta {
  id: View;
  label: string;
  title: string;
  icon: IconName;
  /** Shown in the mobile bottom bar. */
  primary: boolean;
}
export const views: ViewMeta[] = [
  { id: 'home', label: 'HOME', title: 'ホーム', icon: 'home', primary: true },
  { id: 'learn', label: 'LEARN', title: 'おぼえる', icon: 'learn', primary: true },
  { id: 'train', label: 'TRAIN', title: '聴きとる', icon: 'train', primary: true },
  { id: 'levelup', label: 'LEVEL UP', title: 'レベル試験', icon: 'trophy', primary: true },
  { id: 'queue', label: 'QUEUE', title: '遅れ受信', icon: 'queue', primary: false },
  { id: 'exam', label: 'EXAM', title: '一総通', icon: 'exam', primary: true },
  { id: 'qso', label: 'QSO', title: 'QSO 交信', icon: 'radio', primary: false },
  { id: 'collection', label: 'COLLECTION', title: 'カード図鑑', icon: 'collection', primary: true },
  { id: 'analysis', label: 'ANALYSIS', title: '苦手分析', icon: 'analysis', primary: false },
  { id: 'computer-club', label: 'COMPUTER CLUB', title: '放課後パソコン部', icon: 'radio', primary: false },
  { id: 'resources', label: 'REFERENCE', title: '資料', icon: 'learn', primary: false },
  { id: 'settings', label: 'SETTINGS', title: '設定', icon: 'settings', primary: false },
  { id: 'activity', label: 'ACADEMY LOG', title: '学習ログ', icon: 'learn', primary: false },
  { id: 'account', label: 'ACCOUNT', title: 'マイページ', icon: 'account', primary: false },
];
export const viewMeta = (id: View) => id === 'communication' ? {id, label: 'RECEIVING', title: '一総通 電気通信術', icon: 'exam' as const, primary: false} : id === 'geography' ? {id, label: 'GEOGRAPHY', title: '一総通 地理', icon: 'exam' as const, primary: false} : id === 'english' ? {id, label: 'ENGLISH', title: '一総通 専門英語', icon: 'exam' as const, primary: false} : id === 'houki' ? {id, label: 'LAW', title: '一総通 法規', icon: 'exam' as const, primary: false} : id === 'houki-kakomon' ? {id, label: 'PAST', title: '一総通 法規過去問', icon: 'exam' as const, primary: false} : views.find((item) => item.id === id) ?? views[0];
export const audioEngine = new MorseAudioEngine();
/** Dots and dashes rendered with full-width glyphs for readability. */
export const formatCode = (code: string) => code.replaceAll('.', '・').replaceAll('-', '－');
export type CardFamily = 'latin' | 'wabun' | 'kigo';
export const cardFamily = (card: MorseCard): CardFamily => {
  if (card.kind === 'latinLetter') return 'latin';
  if (card.kind === 'wabun') return 'wabun';
  return 'kigo';
};
export const CARD_STATUS_LABEL: Record<ReturnType<typeof cardStatus>, string> = {
  MASTERED: 'GET済み',
  LEARNING: '練習中',
  DISCOVERED: '聴いた',
  UNFOUND: '未発見',
};
export { nowId } from '@/lib/ids';
export const pct = (value: number) => `${Math.round(value * 100)}%`;
export const fmtLatency = (seconds: number) => seconds ? `${Math.round(seconds * 1000)} ms` : '—';
export const cardKey = (card: MorseCard) => `${card.alphabet}:${card.symbol}`;
export const emptyProgress = (): CardProgress => ({ attempts: 0, correct: 0, streak: 0, mastered: false, reviewed: false, exposures: 0, confirmCorrect: 0, progressMeter: 0 });
export const mnemonicFor = (card: MorseCard, progress?: CardProgress) => progress?.customMnemonic || progress?.selectedMnemonic || card.title;
export const mnemonicOptionFor = (card: MorseCard, progress?: CardProgress) => {
  if (progress?.customMnemonic) return { label: progress.customMnemonic, category: 'Custom' as const, segments: undefined };
  const selected = progress?.selectedMnemonic || card.title;
  return card.mnemonics.find((option) => option.label === selected) ?? card.mnemonics[0];
};
export const mnemonicCategoryFor = (card: MorseCard, progress?: CardProgress) => {
  if (progress?.customMnemonic) return 'Custom';
  return card.mnemonics.find((option) => option.label === (progress?.selectedMnemonic || card.title))?.category ?? 'Recommended';
};
export const masteryFor = (progress?: CardProgress) => readProgressMeter(progress);
/** Learned = mastery meter > 0 (confirm/recall XP). Discover-only stays 未習. */
export const isLearned = (progress?: CardProgress) => Boolean(progress?.mastered) || readProgressMeter(progress) > 0;
export const cardStatus = (progress?: CardProgress) => {
  if (progress?.mastered) return 'MASTERED';
  if (isLearned(progress)) return 'LEARNING';
  if ((progress?.exposures ?? 0) > 0) return 'DISCOVERED';
  return 'UNFOUND';
};
export const LEARN_REPEATS = 5;
export const GOAL_LABEL: Record<NonNullable<TrainerProfile['goal']>, string> = {
  fun: '楽しく覚える',
  sound: '音で覚える',
  experienced: '符号既知',
  exam: '一総通',
};
export const goalLabel = (goal: TrainerProfile['goal']) => (goal ? GOAL_LABEL[goal] : '未選択');
export const activeScopeKinds = (profile: TrainerProfile): CharacterKind[] => normalizeKinds(profile.unlockedKinds);
export const scopeLabel = (profile: TrainerProfile) => scopeSetLabel(profile.unlockedKinds) || '欧文';
export const maybeMaster = (progress: CardProgress): CardProgress => {
  if (progress.mastered) return progress;
  const ratio = progress.attempts ? progress.correct / progress.attempts : 0;
  // Existing thresholds: 10+ hintless recalls, 90%+, streak 5, and Discover exposure (reviewed).
  if (progress.attempts >= 10 && ratio >= 0.9 && progress.streak >= 5 && progress.reviewed) {
    return { ...progress, mastered: true, masteredAt: Date.now() };
  }
  return progress;
};

