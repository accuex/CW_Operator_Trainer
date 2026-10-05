'use client';

import { RunDesk, type RunDeskProps } from './RunDesk';
import { CQ_RUN_DESK } from './cqRunFlavor';

export type { RunRecord, RunSaved } from './RunDesk';

/** The CQ run operating desk: the shared run desk with the CQ run's words and frequency check. */
export function CqRunDesk(props: RunDeskProps) {
  return <RunDesk {...props} flavor={CQ_RUN_DESK} />;
}
