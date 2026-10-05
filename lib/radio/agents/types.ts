import type { Station } from '../band';
import type { AirEvent, AirListener, AirParty } from '../air/ether';
import type { AskField } from '../air/intent';
import type { Random } from '../random';

/**
 * A station with a mind of its own. Agents hear the air (only what reaches them),
 * keep their own state and key their own transmitter through the context. Modes
 * place agents on the band; free play will simply leave them running.
 */

export interface AgentMe { call: string; name: string; qth: string }

/** Why an agent left the frequency. 'patience': called too often unanswered; 'waited': waited too long unpicked. */
export type GoneReason = 'patience' | 'waited' | 'timeout' | 'dropped' | 'ignored-correction' | 'never-called';

/** What an agent tells the mode that is keeping the books. */
export type AgentNote =
  | { type: 'called'; agent: Agent }
  | { type: 'selected'; agent: Agent; via: 'call' | 'single' | 'bust' }
  | { type: 'corrected'; agent: Agent; heard: string }
  | { type: 'asked'; agent: Agent; fields: AskField[] }
  | { type: 'exchanged'; agent: Agent }
  | { type: 'closed'; agent: Agent }
  | { type: 'gone'; agent: Agent; reason: GoneReason }
  /** A station using the frequency answered our QRL? ("C", "QRL"…). */
  | { type: 'qrl-answered'; agent: Agent }
  /** A station using the frequency asked us to move ("QRL PSE QSY"). */
  | { type: 'qsy-asked'; agent: Agent };

export interface AgentContext {
  now(): number;
  random: Random;
  /** Key `text` on the agent's transmitter after `delay` seconds (or after what it is sending now). */
  send(agent: Agent, text: string, delay: number): void;
  me: AgentMe;
  /** Everyone else on the frequency (stands in for what an operator would just know). */
  peers(): readonly Agent[];
  notify(note: AgentNote): void;
  /** The agent can hear `party` (anyone, if omitted) keying right now — known before the message is over. */
  hearsKeying(agent: Agent, party?: AirParty): boolean;
  /** When the transmission of `party` the agent hears keying right now began (null: none) — to tell a doubling. */
  keyingSince(agent: Agent, party: AirParty): number | null;
}

export interface Agent extends AirListener {
  readonly id: number;
  readonly key: number;
  readonly station: Station;
  readonly state: string;
  readonly gone: boolean;
  hear(event: AirEvent, ctx: AgentContext): void;
  tick(now: number, ctx: AgentContext): void;
  /** The clock jumped by `shift` seconds (rig power cycled). */
  rebase(shift: number): void;
}
