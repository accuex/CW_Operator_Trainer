import React from 'react';
import sharp from 'sharp';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {AchievementCard} from '../../app/components/AchievementCard';
import {GAME_REWARD_CARDS} from './rewardCatalog';
describe('portrait game reward rendering',()=>{
 it('all nine acquired cards use ready artwork with their own rarity',()=>{
  for(const card of GAME_REWARD_CARDS){const html=renderToStaticMarkup(React.createElement(AchievementCard,{achievement:card,unlocked:true}));
   expect(card.artworkPending).toBe(false);expect(html).not.toContain('カード画像準備中');expect(html).toContain(`rarity-${card.rarity.toLowerCase()}`);expect(html).toContain('CW迎撃隊');expect(html).not.toContain('<img');
   if(card.rarity==='SSSR')expect(html).toContain('foil-layer');
  }
 });
 // Artwork is deployed separately and intentionally excluded from Git.
 it.skipIf(!GAME_REWARD_CARDS.every(card=>existsSync(resolve('public',card.artwork.slice(1)))))('all reward URLs resolve to portrait WebP files preserving the supplied dimensions',async()=>{
  for(const card of GAME_REWARD_CARDS){const metadata=await sharp(resolve('public',card.artwork.slice(1))).metadata();expect(metadata.format).toBe('webp');expect([metadata.width,metadata.height]).toEqual([1024,1536]);}
 });
 it('unearned cards use the existing concealed card, never the reward face',()=>{
  for(const card of GAME_REWARD_CARDS){const html=renderToStaticMarkup(React.createElement(AchievementCard,{achievement:card,unlocked:false}));expect(html).toContain('is-concealed');expect(html).not.toContain(card.title);}
 });
});
