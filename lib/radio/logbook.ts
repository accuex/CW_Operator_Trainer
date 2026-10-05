import type { QsoContactSummary, SessionRecord } from '../types';

export interface LogbookEntry extends QsoContactSummary {
  /** Unique within the logbook: session id plus the contact's index. */
  id: string;
  sessionId: string;
  modeId: string;
}

/** One line per contact, oldest first. Sessions saved before `contacts` count as a single contact. */
export function logbookEntries(sessions: SessionRecord[]): LogbookEntry[] {
  return sessions.flatMap((session) => {
    const qso = session.qso;
    if (!qso) return [];
    const contacts = qso.contacts ?? [{ call: qso.call, fields: qso.fields, fieldsCorrect: qso.fieldsCorrect, outcome: qso.outcome, at: session.endedAt }];
    return contacts.map((contact, index) => ({ ...contact, id: `${session.id}:${index}`, sessionId: session.id, modeId: qso.modeId }));
  });
}
