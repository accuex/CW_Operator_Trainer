/** Public display references only. Private PDF, exact ranges and verification evidence stay outside this graph. */
export interface ContentRef { id: string; version: number }
export interface ContentReview extends ContentRef { contentRef: ContentRef; purpose: 'original_sample' | 'historical' | 'current_note' | 'amendment'; rights: 'original_author' | 'cleared' | 'pending'; humanApproval: 'not_applicable_sample' | 'approved' | 'pending'; releaseApproved: boolean }
export interface LegalSource extends ContentRef { title: string; url: string | null; locatorLabel: string | null; asOfDate: string | null }
export interface LegalCondition extends ContentRef { label: string; operator: 'AND' | 'OR'; requirements: string[]; exceptions: string[] }
export interface LegalRule extends ContentRef { subject: string; action: string; conditionIds: string[]; sourceIds: string[] }
export interface HistoricalBlank extends ContentRef { printedPositionId: string; slotLabel: string; historicalAnswer: string }
export interface PrintedBlank extends ContentRef { printedPositionId: string; slotLabel: string; answer: string }
export interface HistoricalQuestion extends ContentRef { examDate: string; questionNumber: string; canonicalRef: ContentRef; blankRefs: ContentRef[] }
export interface HistoricalCanonical extends ContentRef { questionRefs: ContentRef[] }
export interface AmendmentEvent extends ContentRef { before: string; after: string; change: string; promulgatedAt: string | null; effectiveAt: string | null; reason: string | null; sourceIds: string[]; unknowns: string[] }
export interface TriviaCard extends ContentRef { kind: 'amendment' | 'pitfall'; title: string; text: string; eventId: string | null; sourceIds: string[]; reviewId: string }
export interface LearningNote extends ContentRef { chapterId: string; title: string; goal: string; explanation: string; ruleIds: string[]; steps: string[]; questionIds: string[]; cardIds: string[]; sourceIds: string[]; scope: string; unknowns: string[]; asOfDate: string | null; effectiveStatus: 'not_applicable_sample' | 'verified' | 'unresolved'; publicEligibility: 'sample' | 'approved_candidate' | 'needs_context' | 'blocked'; reviewId: string }
export type RedToken = {kind:'text'; text:string} | {kind:'blank'; blankId:string};
export interface RedQuestion extends ContentRef { provenance: 'original_sample' | 'historical'; title: string; chapterId: string; themeId: string; sampleYear: string | null; historicalRef: HistoricalQuestion | null; tokens: RedToken[]; blanks: PrintedBlank[]; explanation: string; relationToCurrent: string; reviewId: string }
export interface TrainerMaster { schemaVersion:1; edition:'original_sample' | 'approved_release'; historicalCanonicals:HistoricalCanonical[]; historicalQuestions:HistoricalQuestion[]; historicalBlanks:HistoricalBlank[]; chapters:{id:string;title:string}[]; notes:LearningNote[]; rules:LegalRule[]; conditions:LegalCondition[]; questions:RedQuestion[]; cards:TriviaCard[]; amendments:AmendmentEvent[]; sources:LegalSource[]; reviews:ContentReview[] }
