import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import manifest from './illustration-manifest.json';
import EnglishIllustration from '../../app/components/EnglishIllustration';

const masterBytes = readFileSync('public/english/data/english-learning-master-v1.json');
const master = JSON.parse(masterBytes.toString()) as { items: { learningEntityId: string; category: string }[] };
const render = (id: string, meaningRevealed: boolean) => renderToStaticMarkup(createElement(EnglishIllustration, { learningEntityId: id, meaningRevealed }));

describe('English illustration release safeguards', () => {
  it('preserves the complete E2.0.1 master, including learner wording and metadata', () => {
    expect(readFileSync('docs/1sou_english/StageE2/english_learning_master_v1.json')).toEqual(masterBytes);
    expect(createHash('sha256').update(masterBytes).digest('hex')).toBe('0742bb407f6b3f6ef353b3a675bb54faaf60c92a45171f94cb545b4e090af403');
    expect(manifest.sourceMasterSha256).toBe('0742bb407f6b3f6ef353b3a675bb54faaf60c92a45171f94cb545b4e090af403');
  });
  it('never reveals an answer image, alt or caption while the meaning is hidden', () => {
    for (const id of Object.keys(manifest.items)) expect(render(id, false)).toBe('');
    expect(render('term-bridge', true)).toContain('船橋');
  });
  it('renders no placeholders for non-illustrated or unknown items, including legal wording', () => {
    for (const item of master.items) {
      if (!(item.learningEntityId in manifest.items)) expect(render(item.learningEntityId, true)).toBe('');
      if (item.category === 'LEGAL') expect(item.learningEntityId in manifest.items).toBe(false);
    }
    expect(render('unknown-item', true)).toBe('');
  });
  it('keeps stable mappings valid and all assets approved by human review', () => {
    const ids = new Set(master.items.map(i => i.learningEntityId));
    expect(Object.keys(manifest.items)).toHaveLength(18);
    expect(Object.keys(manifest.assets)).toHaveLength(16);
    for (const [id, item] of Object.entries(manifest.items)) {
      expect(ids.has(id)).toBe(true);
      expect(item.assetId in manifest.assets).toBe(true);
      expect(item.alt).toBeTruthy();
      const html = render(id, true);
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('decoding="async"');
      expect(html).toContain('width="480" height="320"');
      expect(html).toContain('srcSet=');
      expect(html).not.toContain('rel="preload"');
    }
    for (const asset of Object.values(manifest.assets)) {
      expect(asset.status).toBe('approved');
      expect(asset.variants.map(v => v.width)).toEqual([480, 960]);
      for (const v of asset.variants) {
        expect(v.width / v.height).toBe(1.5);
        expect(v.src).toMatch(/^\/english\/illustrations\/[a-z-]+(?:-v\d+)?-(480|960)\.webp$/);
        expect(statSync(`public${v.src}`).size).toBe(v.bytes);
        expect(v.bytes).toBeLessThan(90_000);
        expect(readFileSync(`public${v.src}`).toString('ascii', 8, 12)).toBe('WEBP');
      }
    }
    const review = JSON.parse(readFileSync('docs/1sou_english/StageE2_1/human_visual_review.json', 'utf8')) as {
      decision: string; assets: { assetId: string; decision: string; variants: { src: string; sha256: string }[] }[];
    };
    expect(review.decision).toBe('approved');
    expect(review.assets.map(a => a.assetId).sort()).toEqual(Object.keys(manifest.assets).sort());
    for (const asset of review.assets) {
      expect(asset.decision).toBe('approved');
      expect(asset.variants.map(v => v.src)).toEqual(manifest.assets[asset.assetId as keyof typeof manifest.assets].variants.map(v => v.src));
      for (const v of asset.variants) expect(createHash('sha256').update(readFileSync(`public${v.src}`)).digest('hex')).toBe(v.sha256);
    }
  });
});
