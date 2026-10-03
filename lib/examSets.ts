/**
 * 事前作文の試験セット（data/exam/sets.json 1本）。
 * OCR原文は使わず scripts/generateExamSets.mjs で生成。
 */
import examSetsFile from '../data/exam/sets.json';

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

type ExamSetsFile = {
  version: number;
  count: number;
  plain: StoredPlainSet[];
  codes: StoredCodesSet[];
  wabun: StoredWabunSet[];
};

const file = examSetsFile as ExamSetsFile;

const BY_SUBJECT: Record<ExamSetSubjectId, StoredExamSet[]> = {
  plain: file.plain,
  codes: file.codes,
  wabun: file.wabun,
};

export function storedExamSetCount(subjectId: ExamSetSubjectId): number {
  return BY_SUBJECT[subjectId]?.length ?? 0;
}

/** 事前セットからランダムに1本。無ければ null */
export function pickStoredExamSet(subjectId: ExamSetSubjectId): StoredExamSet | null {
  const pool = BY_SUBJECT[subjectId];
  if (!pool?.length) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export function getStoredExamSet(subjectId: ExamSetSubjectId, id: string): StoredExamSet | null {
  return BY_SUBJECT[subjectId]?.find((set) => set.id === id) ?? null;
}
