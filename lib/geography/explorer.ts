import { drillPool } from './engine/stage14-core.js';
import type { Dataset, Entity, Master } from './types';

// Only schema categories represented by verified points or geometries. No name-based subtype inference.
export const POINT_TYPES = {
  station: { label: '海岸局', symbol: '◎' },
  port: { label: '港・都市', symbol: '■' },
  landform: { label: '地形（島・岬・半島など）', symbol: '▲' },
  strait: { label: '海峡・水道', symbol: '◆' },
  sea: { label: '海名・湾', symbol: '▱' },
  country: { label: '国', symbol: '▱' },
} as const;
export function explorerPoints(master: Master, periodRows: Entity[]) {
  const periods = new Map(periodRows.map(e => [e.learningEntityId, e]));
  return drillPool(master.entities).map(e => ({ ...e, ...periods.get(e.learningEntityId) }));
}
export function appearanceCount(e: Entity) { return e.choiceCount ?? e.provisionalChoiceCount ?? 0; }
// Display normalization only, matching the original prototype's square-root radius. Never a ranking score.
export function markerRadius(count: number, maximum: number) {
  return 4 + 10 * Math.sqrt(Math.max(0, count) / Math.max(1, maximum, count));
}
export function countText(e: Entity) {
  return e.choiceCount === null ? `OCR参考登場回数 ${e.provisionalChoiceCount ?? 0}回` : `選択肢登場回数（正解・不正解を問わず） ${e.choiceCount}回`;
}

export function explorerGeometries(data: Dataset, periodRows: Entity[]) {
  const periods = new Map(periodRows.map(e => [e.learningEntityId, e]));
  return data.master.entities.filter(e => e.coordinateConfidence === 'verified_area_geometry' && e.geometryId && data.geoms[e.geometryId]).map(e => ({ ...e, ...periods.get(e.learningEntityId) }));
}
