export type Scope = 'A' | 'AB' | 'ABC' | 'ALL';
export type Grade = 'correct' | 'sufficient' | 'near' | 'incorrect' | 'revealed' | 'skipped';
export type Point = [
    number,
    number
];
export interface Entity {
    learningEntityId: string;
    canonicalEntityIds: string[];
    displayName: string;
    aliases: string[];
    areaId: string;
    areaName: string;
    lat: number | null;
    lon: number | null;
    learningReady: boolean;
    coordinateConfidence: string;
    entityType: string;
    geometryId: string | null;
    priorityClass: 'A' | 'B' | 'C' | 'D';
    areaRank: number;
    score: number;
    choiceCount: number | null;
    correctCount: number | null;
    provisionalChoiceCount: number | null;
    examSessionCount: number;
    examIds: string[];
    firstAppearance: string | null;
    lastAppearance: string | null;
    historical?: boolean;
    historicalBasis?: string;
    currentStatus: unknown;
    historicalStatus: unknown;
    frequencyBasis: string;
    evidenceSummary: {
        coordinateSourceIds?: string[];
    };
}
export interface Area {
    areaId: string;
    areaName: string;
    bounds: [
        number,
        number,
        number,
        number
    ];
    status: string;
    learningCount: number;
    learningReadyCount: number;
    cumulative: Record<Scope, number>;
}
export interface Master {
    areas: Area[];
    entities: Entity[];
    counts: Record<string, unknown>;
}
export interface Geometry {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
}
export interface Projection {
    W: number;
    H: number;
    project: (p: Point) => Point;
    unproject: (p: Point) => Point;
}
export interface Config {
    area: string;
    scope: Scope;
    direction: 'name' | 'position';
    size: '10' | '20' | 'all';
    period: 'all' | '10' | '5' | 'custom';
    from: string;
    to: string;
}
export interface Session {
    eligible: string[];
    fresh: string[];
    retries: {
        entity_id: string;
        due: number;
    }[];
    step: number;
    lastRetryStep: number;
    current: string | null;
    results: {
        entity_id: string;
        grade: Grade;
        step: number;
    }[];
    area?: string;
    scope?: Scope;
    direction?: string;
}
export interface Checkpoint {
    sessionID: string;
    session: Session;
    snapshot: Config;
    currentID: string;
    solved: boolean;
    grade: Grade | null;
    answerPoint: Point | null;
}
export interface ProgressEntry {
    attempts: number;
    correct: number;
    incorrect: number;
    sessionCount: number;
    lastPracticedAt: string;
    recentResult: Grade;
    lastSessionId: string;
    area: string;
    scope: Scope;
    mode: string;
}
export interface Outcome {
    firstCorrect: number;
    firstWrong: number;
    corrected: number;
    answered: number;
    total: number;
    wrongIDs: string[];
}
export interface Progress {
    schemaVersion: number;
    entities: Record<string, ProgressEntry>;
    recent: {
        learningEntityId: string;
        grade: Grade;
        area: string;
        scope: Scope;
        mode: string;
        at: string;
    }[];
    last: Config | null;
    active: Checkpoint | null;
    completed: (Outcome & {
        sessionID: string;
        area: string;
        at: string;
    })[];
}
export interface Store {
    readonly data: Progress;
    readonly warning: string;
    readonly writable: boolean;
    save: () => void;
    replace: (p: Progress) => void;
    reset: (area: string | null) => void;
}
export interface Dataset {
    master: Master;
    seed: {
        sources: {
            id: string;
            title?: string;
            url?: string;
        }[];
    };
    db: unknown;
    keys: unknown;
    groups: unknown;
    model: unknown;
    signals: unknown;
    geoms: Record<string, Geometry>;
    base: {
        features: {
            geometry: Geometry;
        }[];
    };
    periods: Record<'all' | '10' | '5', Entity[]>;
}
