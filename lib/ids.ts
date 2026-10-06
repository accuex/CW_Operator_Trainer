/** A record id: the wall clock and six random characters (sessions, run traces, answers). */
export const nowId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
