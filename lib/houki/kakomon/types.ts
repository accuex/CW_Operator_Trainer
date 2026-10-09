/** 法規過去問プレイヤーの原問。設計書 §5。英語科目は定義しない。 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'blank'; label: string }
  | { t: 'ruby'; base: string; reading: string };

export type Block =
  | { t: 'p'; body: Inline[] }
  | { t: 'item'; marker: string; body: Inline[]; children?: Block[] }
  | { t: 'note'; marker: string; body: Inline[] };

export interface ProvisionRef {
  article: string;
  paragraph?: string;
  item?: string;
  subItem?: string;
  supplementary?: { amendingLaw: string | null } | null;
  relation?: 'direct' | 'appliedMutatisMutandis' | 'readAs';
  via?: { law: string; provision: ProvisionRef } | null;
}

export interface LegalRef {
  law: string;
  lawId: string | null;
  raw: string;
  provisions: ProvisionRef[];
}

interface QuestionBase {
  id: string;
  section: 'A' | 'B';
  number: number;
  revision: number;
  lead: Inline[];
  body: Block[];
  legalRefs: LegalRef[];
  tags: string[];
  variantGroup: string | null;
  explanation: Block[] | null;
}

export interface SingleQuestion extends QuestionBase {
  format: 'single';
  polarity: 'positive' | 'negative';
  choices: { no: number; body: Block[] }[];
  answer: number;
  points: number;
}

export interface CombinationQuestion extends QuestionBase {
  format: 'combination';
  columns: string[];
  rows: { no: number; cells: Inline[][] }[];
  answer: number;
  points: number;
}

export interface JudgeQuestion extends QuestionBase {
  format: 'judge';
  labels: { '1': string; '2': string };
  items: { id: string; label: string; body: Block[]; answer: 1 | 2 }[];
  pointsEach: number;
}

export interface WordBankQuestion extends QuestionBase {
  format: 'wordBank';
  bank: { no: number; body: Inline[] }[];
  items: { id: string; label: string; answer: number }[];
  pointsEach: number;
}

export type Question = SingleQuestion | CombinationQuestion | JudgeQuestion | WordBankQuestion;

export interface QuestionRevision {
  questionId: string;
  revision: number;
  contentDigest: string;
  answerDigest: string;
  change: 'initial' | 'cosmetic' | 'semantic' | 'answerFix';
  at: string;
  erratumIds: string[];
}

export interface PublicationEvidence {
  kind: 'currentListing' | 'archivedListing' | 'officialDomainOrigin' | 'pdfInternal';
  url: string | null;
  checkedAt: string;
  sitting: string;
  savedArtifactSha256: string | null;
  note: string;
}

export interface ExamSet {
  kind: 'kakomon';
  schemaVersion: 1;
  id: string;
  contentVersion: number;
  qualification: '1sou';
  subject: 'houki' | 'kiso' | 'kougakuA' | 'kougakuB';
  exam: {
    year: number;
    month: 3 | 9;
    label: string;
    code: string;
    durationMin: number;
  };
  scoring: {
    fullMarks: number;
    passMark: number;
    sectionA: { count: number; pointsEach: number };
    sectionB: { count: number; pointsEach: number; mode: 'perSubItem' | 'unspecified' };
    note: string;
  };
  source: {
    questionPdf: string;
    answerPdf: string;
    questionPdfSha256: string;
    answerPdfSha256: string;
    extractedWith: string;
  };
  distribution: 'private' | 'review' | 'public';
  rights: {
    status: 'unconfirmed' | 'eligible' | 'onHold' | 'excluded';
    termsId: string | null;
    publicationEvidence: PublicationEvidence[];
    holds: { reason: string; scope: string; at: string; resolvedAt: string | null; resolution: 'resumed' | 'excluded' | null }[];
    approvedBy: string | null;
    approvedAt: string | null;
  };
  attribution: {
    organization: '公益財団法人日本無線協会';
    qualificationLabel: string;
    subjectLabel: string;
  };
  review: {
    transcription: 'draft' | 'checked' | 'approved';
    checkedBy: string | null;
    checkedAt: string | null;
  };
  questions: Question[];
  questionRevisions: QuestionRevision[];
}
