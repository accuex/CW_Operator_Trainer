import type { Dataset, Entity } from './types';
const names = ['learning-master-stage13.json', 'learning-seed-stage13.json', 'database-stage12.json', 'answer-keys.json', 'learning-groups-stage12.json', 'learning-model-stage12.json', 'raw-signals-stage13.json', 'geometries-stage13.json', 'basemap-stage13.geojson', 'learning-period-all-stage13.json', 'learning-period-10-stage13.json', 'learning-period-5-stage13.json'];
export const GEOGRAPHY_FILE_COUNT = names.length;
export interface GeographyLoadProgress { completed: number; total: number }
let cached: Promise<Dataset> | null = null;
let completed = 0, generation = 0;
const listeners = new Set<(progress: GeographyLoadProgress) => void>();
const progress = () => ({ completed, total: GEOGRAPHY_FILE_COUNT });
export function loadGeography(onProgress?: (progress: GeographyLoadProgress) => void): Promise<Dataset> {
    if (!cached) {
        completed = 0;
        const requestGeneration = ++generation;
        cached = (async () => {
            const [master, seed, db, keys, groups, model, signals, geoms, base, all, ten, five] = await Promise.all(names.map(async (name) => {
                const r = await fetch('/geography/data/' + name);
                if (!r.ok) throw Error('教材読込失敗');
                const value = await r.json();
                if (generation === requestGeneration) {
                    completed += 1;
                    listeners.forEach(listener => listener(progress()));
                }
                return value;
            }));
            return { master, seed, db, keys, groups, model, signals, geoms, base, periods: {
                all: (all as { entities: Entity[] }).entities,
                '10': (ten as { entities: Entity[] }).entities,
                '5': (five as { entities: Entity[] }).entities,
            } } as Dataset;
        })().catch(e => { generation += 1; cached = null; throw e; });
    }
    if (!onProgress) return cached;
    listeners.add(onProgress);
    onProgress(progress());
    return cached.finally(() => listeners.delete(onProgress));
}
