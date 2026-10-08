/**
 * 事前作文の試験セット。原本は data/exam/sets.json（scripts/generateExamSets.mjs で生成）。
 * アプリへは public/exam/sets/ のシャード（scripts/splitExamSets.mjs）から必要分だけ取得する。
 */
import shardManifest from '../data/exam/shards.json';

export type ExamSetSubjectId = 'wabun' | 'codes' | 'plain';

export type StoredOubunTelegram = {
  number: string;
  office: string;
  address: string;
  body: string;
  receivedAt: string;
  date?: string;
  signature?: string;
};

export type StoredWabunTelegram = {
  office: string;
  officeNumeric: boolean;
  number: string;
  hour: number;
  minute: number;
  address: string;
  body: string;
  pages: number;
};

export type StoredPlainSet = {
  id: string;
  subjectId: 'plain';
  telegrams: StoredOubunTelegram[];
};

export type StoredCodesSet = {
  id: string;
  subjectId: 'codes';
  telegrams: StoredOubunTelegram[];
};

export type StoredWabunSet = {
  id: string;
  subjectId: 'wabun';
  telegrams: StoredWabunTelegram[];
};

export type StoredExamSet = StoredPlainSet | StoredCodesSet | StoredWabunSet;

type ExamSetShardManifest = {
  version: number;
  setsPerShard: number;
  shards: Record<ExamSetSubjectId, number>;
};

const manifest = shardManifest as ExamSetShardManifest;

export function examSetShardUrl(subjectId: ExamSetSubjectId, index: number): string {
  return `/exam/sets/v${manifest.version}/${subjectId}/${String(index).padStart(2, '0')}.json`;
}

const shardCache = new Map<string, Promise<StoredExamSet[]>>();
/** 次の出題に使うシャード（先読み済みのものを優先する） */
const nextShard = new Map<ExamSetSubjectId, number>();

function loadShard(subjectId: ExamSetSubjectId, index: number): Promise<StoredExamSet[]> {
  const url = examSetShardUrl(subjectId, index);
  let pending = shardCache.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error(`exam set shard ${response.status}`);
      return (await response.json()) as StoredExamSet[];
    });
    pending.catch(() => shardCache.delete(url));
    shardCache.set(url, pending);
  }
  return pending;
}

const randomShard = (subjectId: ExamSetSubjectId) =>
  Math.floor(Math.random() * (manifest.shards[subjectId] ?? 0));

/** 科目を選んだ時点で1シャードだけ取りに行く */
export function prefetchStoredExamSet(subjectId: ExamSetSubjectId): void {
  if (!manifest.shards[subjectId]) return;
  const index = randomShard(subjectId);
  nextShard.set(subjectId, index);
  loadShard(subjectId, index).catch(() => undefined);
}

/** 事前セットからランダムに1本。取得できなければ null（呼び出し側はその場生成に落とす） */
export async function pickStoredExamSet(subjectId: ExamSetSubjectId): Promise<StoredExamSet | null> {
  if (!manifest.shards[subjectId]) return null;
  const index = nextShard.get(subjectId) ?? randomShard(subjectId);
  try {
    const pool = (await loadShard(subjectId, index)).filter((set) => set.subjectId === subjectId);
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
  } catch {
    return null;
  } finally {
    prefetchStoredExamSet(subjectId);
  }
}
