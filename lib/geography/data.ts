import type { Dataset, Entity } from './types';
let cached: Promise<Dataset> | null = null;
export function loadGeography(): Promise<Dataset> {
    if (!cached)
        cached = (async () => { const names = ['learning-master-stage13.json', 'learning-seed-stage13.json', 'database-stage12.json', 'answer-keys.json', 'learning-groups-stage12.json', 'learning-model-stage12.json', 'raw-signals-stage13.json', 'geometries-stage13.json', 'basemap-stage13.geojson', 'learning-period-all-stage13.json', 'learning-period-10-stage13.json', 'learning-period-5-stage13.json']; const [master, seed, db, keys, groups, model, signals, geoms, base, all, ten, five] = await Promise.all(names.map(async (name) => { const r = await fetch('/geography/data/' + name); if (!r.ok)
            throw Error('教材読込失敗'); return r.json(); })); return { master, seed, db, keys, groups, model, signals, geoms, base, periods: { all: (all as {
                    entities: Entity[];
                }).entities, '10': (ten as {
                    entities: Entity[];
                }).entities, '5': (five as {
                    entities: Entity[];
                }).entities } } as Dataset; })().catch(e => { cached = null; throw e; });
    return cached;
}
