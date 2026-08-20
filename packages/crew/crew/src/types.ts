/**
 * Public type vocabulary of the crew domain: id brands and the fixed role,
 * ticket-status, and message-kind unions every `ctx.crew` consumer shares.
 * Types only — the id factories and record shapes live in `index.ts`/`spec.ts`.
 * @module @deepseek-ai/dsh-crew/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one durable ticket record (generated uuid). */
export type CrewTicketId = Branded<'CrewTicketId'>

/** Identifies one durable message-pool record (generated uuid). */
export type CrewMessageId = Branded<'CrewMessageId'>

/**
 * Fixed crew role vocabulary. Closed, not deployment-configurable: role
 * identity is load-bearing to ticket-transition and tool-authority rules
 * (only a hired `reviewer` can call `verdict`; only `director`/`strategist`
 * can open tickets), so it is a protocol constant like a tool name, not a
 * tunable a deployment chooses.
 */
export type CrewRole = 'director' | 'researcher' | 'strategist' | 'engineer' | 'reviewer'

/**
 * Ticket lifecycle. `done` is reachable only through `CrewRuntime.verdict`'s
 * `accept` outcome — no other transition can set it, which is the
 * enforcement point for requiring independent review before a ticket closes.
 * A `reject` verdict returns an `in-review` ticket directly to `assigned`
 * (same assignee, rationale attached as new context) rather than resting in
 * a separate `rejected` status nothing else transitions out of.
 */
export type CrewTicketStatus = 'open' | 'assigned' | 'in-progress' | 'in-review' | 'done' | 'blocked'

/**
 * Structured message-pool payload kind. A published message is data a role
 * can filter and process, not a chat line — a structured handoff rather than
 * free text.
 */
export type CrewMessageKind = 'finding' | 'decision' | 'handoff' | 'blocker'
