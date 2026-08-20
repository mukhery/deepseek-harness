/**
 * The crew domain declaration: one process-wide `crew` domain whose roster,
 * ticket, and message-pool records each carry an explicit `workspaceId`
 * field. This is the same per-record scoping shape `dsh-workspace`'s own
 * domain uses for its many `WorkspaceRecord`s — one domain instance holding
 * every project's data, not one domain per workspace: domain names are
 * process-wide and single-open (`DomainFacility.open` rejects a name already
 * open), so opening N domains for N workspaces is not how the seam works.
 * The zod schemas are the durable-boundary validators; the record types they
 * infer are this package's public ticket/roster/message shapes.
 * @module @deepseek-ai/dsh-crew/src/spec
 */

import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { CrewMessageId, CrewTicketId } from './types.ts'

/** Workspace id schema at the durable boundary; branding has no runtime representation. */
const workspaceIdSchema = z.string().transform(value => value as WorkspaceId)
/** Ticket id schema at the durable boundary. */
const crewTicketIdSchema = z.string().transform(value => value as CrewTicketId)
/** Message id schema at the durable boundary. */
const crewMessageIdSchema = z.string().transform(value => value as CrewMessageId)

/** The fixed role vocabulary, mirrored from `CrewRole` (zod enums cannot import a hand type's literal list). */
const crewRoleSchema = z.enum(['director', 'researcher', 'strategist', 'engineer', 'reviewer'])
/** The fixed ticket-status vocabulary, mirrored from `CrewTicketStatus`. */
const crewTicketStatusSchema = z.enum(['open', 'assigned', 'in-progress', 'in-review', 'done', 'blocked'])
/** The fixed message-kind vocabulary, mirrored from `CrewMessageKind`. */
const crewMessageKindSchema = z.enum(['finding', 'decision', 'handoff', 'blocker'])

/** Durable shape of one roster record; table key is `memberSessionId`. */
export const crewRosterRecord = z.object({
  memberSessionId: z.string().transform(SessionId),
  workspaceId: workspaceIdSchema,
  role: crewRoleSchema,
  label: z.string(),
  hiredAt: z.string(),
})

/** One stored roster record, inferred from {@link crewRosterRecord}. */
export type CrewRosterRecord = z.infer<typeof crewRosterRecord>

/** Durable shape of one ticket record; table key is `id`. */
export const crewTicketRecord = z.object({
  id: crewTicketIdSchema,
  workspaceId: workspaceIdSchema,
  title: z.string(),
  objective: z.string(),
  role: crewRoleSchema,
  status: crewTicketStatusSchema,
  assigneeSessionId: z.string().transform(SessionId).optional(),
  evidence: z.string().optional(),
  summary: z.string().optional(),
  prUrl: z.string().optional(),
  verdictRationale: z.string().optional(),
  blockedReason: z.string().optional(),
  citesMessageIds: z.array(crewMessageIdSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/** One stored ticket record, inferred from {@link crewTicketRecord}. */
export type CrewTicketRecord = z.infer<typeof crewTicketRecord>

/** Durable shape of one message-pool record; table key is `id`. */
export const crewMessageRecord = z.object({
  id: crewMessageIdSchema,
  workspaceId: workspaceIdSchema,
  topic: z.string(),
  kind: crewMessageKindSchema,
  from: z.string().transform(SessionId),
  body: z.string(),
  citesTicketId: crewTicketIdSchema.optional(),
  createdAt: z.string(),
})

/** One stored message-pool record, inferred from {@link crewMessageRecord}. */
export type CrewMessageRecord = z.infer<typeof crewMessageRecord>

/**
 * The crew domain spec: one process-wide domain with `roster`, `tickets`, and
 * `messages` tables, each record self-scoped by `workspaceId`. The runtime
 * opens this through `ctx.storage.domain`; the spec object is the single
 * source of the domain's identity, version, and schemas.
 */
export const crewDomainSpec = defineDomain({
  name: 'crew',
  version: 1,
  tables: {
    roster: domainTable<SessionId, CrewRosterRecord>(crewRosterRecord),
    tickets: domainTable<CrewTicketId, CrewTicketRecord>(crewTicketRecord),
    messages: domainTable<CrewMessageId, CrewMessageRecord>(crewMessageRecord),
  },
})
