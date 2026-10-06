'use client';

import type { TrainerProfile } from '@/lib/types';
import type { IconName } from '@/app/components/icons';

export type GoalId = NonNullable<TrainerProfile['goal']>;

export const GOAL_CHOICES: [GoalId, IconName, string, string][] = [
  ['sound', 'ear', '音感法で始める', '符号のリズムを直接認識（実践向け）'],
  ['fun', 'sparkle', '合調法で始める', '語呂を足場にする（入門用）'],
  ['experienced', 'bolt', '符号はすでに知っている', '音感法のみ。移行診断と高速訓練へ'],
  ['exam', 'exam', '第一級総合無線通信士を目指す', '音感法のみ。Queue 3 → 試験訓練'],
];

export const METHOD_GOALS = GOAL_CHOICES.slice(0, 2);
export const SOUND_ONLY_GOALS = GOAL_CHOICES.slice(2);

export const isSoundOnlyGoal = (goal: TrainerProfile['goal']) => goal === 'experienced' || goal === 'exam';
export const showsMnemonic = (goal: TrainerProfile['goal']) => goal === 'fun';
