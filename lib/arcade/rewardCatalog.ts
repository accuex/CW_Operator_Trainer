/** Approved game rewards. Artwork supplied by the project owner. */
export const GAME_REWARDS = [
  { id: 'cw-guard:first-clear', file: 'cwdef_first_clear_r', rarity: 'R', title: 'はじめての迎撃', condition: '8WPM以上でSTAGE 1クリア' },
  { id: 'cw-guard:stage3-clear', file: 'cwdef_stage3_clear_sr', rarity: 'SR', title: '一人前の迎撃隊員', condition: '12WPM以上でSTAGE 3クリア' },
  { id: 'cw-guard:boss-clear', file: 'cwdef_boss_clear_ssr', rarity: 'SSR', title: 'シグナル・マスター討伐', condition: '15WPM以上でボス撃破' },
  { id: 'cw-guard:speed20', file: 'cwdef_speed20_sssr', rarity: 'SSSR', title: '高速迎撃', condition: '20WPM以上でSTAGE 3クリア' },
  { id: 'cw-guard:boss20', file: 'cwdef_boss20_sssr', rarity: 'SSSR', title: 'シグナル・マスター制圧', condition: '20WPM以上でボス撃破' },
  { id: 'cw-guard:perfect-defense', file: 'cwdef_perfect_defense_sssr', rarity: 'SSSR', title: '鉄壁防衛', condition: '15WPM以上、開始から街の損傷なしでボス撃破' },
  { id: 'cw-guard:combo80', file: 'cwdef_combo80_sssr', rarity: 'SSSR', title: '連続迎撃の達人', condition: '15WPM以上で最大80 COMBO達成' },
  { id: 'cw-guard:wabun', file: 'cwdef_wabun_sssr', rarity: 'SSSR', title: '和文迎撃の達人', condition: '和文15WPM以上でボス撃破' },
  { id: 'cw-guard:ace', file: 'cwdef_ace_sssr', rarity: 'SSSR', title: '伝説の迎撃隊長', condition: '20WPM以上、開始から符号ヒントOFFでボス撃破' },
] as const;
export type GameRewardId = typeof GAME_REWARDS[number]['id'];
export const isGameReward = (id: string) => id.startsWith('cw-guard:');
export const GAME_REWARD_CARDS = GAME_REWARDS.map(reward => ({
  ...reward, artwork: `/cards/achievments/${reward.rarity.toLowerCase()}/${reward.file}.webp`,
  description: 'CW迎撃隊のゲーム内攻略実績を記念するコレクションカード。',
  game: 'cw-guard' as const, artworkPending: false,
}));
export function speedTier(wpm: number) {
  return wpm >= 20 ? 'SSSR' : wpm >= 15 ? 'SSR' : wpm >= 12 ? 'SR' : 'R';
}
