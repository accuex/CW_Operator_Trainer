import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {AchievementCard} from '../../app/components/AchievementCard';
import {GAME_REWARD_CARDS} from './rewardCatalog';
describe('portrait game reward rendering',()=>{
 it('all nine acquired cards use pending artwork faces with their own rarity and no borrowed image',()=>{
  for(const card of GAME_REWARD_CARDS){const html=renderToStaticMarkup(React.createElement(AchievementCard,{achievement:card,unlocked:true}));
   expect(html).toContain('カード画像準備中');expect(html).toContain(`rarity-${card.rarity.toLowerCase()}`);expect(html).toContain('CW迎撃隊');expect(html).not.toContain('<img');
   if(card.rarity==='SSSR')expect(html).toContain('foil-layer');
  }
 });
 it('unearned cards use the existing concealed card, never the reward face',()=>{
  for(const card of GAME_REWARD_CARDS){const html=renderToStaticMarkup(React.createElement(AchievementCard,{achievement:card,unlocked:false}));expect(html).toContain('is-concealed');expect(html).not.toContain(card.title);}
 });
});
