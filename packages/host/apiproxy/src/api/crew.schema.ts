/**
 * crew domain zod schemas (names derived from map keys), mirroring
 * workspace.schema.ts's shape. Enum literals are copied from `CrewRole`/
 * `CrewTicketStatus`, the same wire-local mirroring crew.ts documents.
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { CrewTicketId, CrewRosterView, CrewTicketView } from './crew.ts'
import { sessionIdSchema, workspaceIdSchema } from './sessions.schema.ts'

/** Wire-side ticket id: opaque, non-empty string, branded at parse (same posture as `workspaceIdSchema`). */
export const crewTicketIdSchema = z.string().min(1) as unknown as z.ZodType<CrewTicketId>

/** The fixed role vocabulary, mirrored from `CrewRole`. */
export const crewRoleSchema = z.enum(['director', 'researcher', 'strategist', 'engineer', 'reviewer'])

/** The fixed ticket-status vocabulary, mirrored from `CrewTicketStatus`. */
export const crewTicketStatusSchema = z.enum(['open', 'assigned', 'in-progress', 'in-review', 'done', 'blocked'])

/** CrewRosterView row of every crew.board response. */
export const crewRosterViewSchema = z.object({
  memberSessionId: sessionIdSchema,
  workspaceId: workspaceIdSchema,
  role: crewRoleSchema,
  label: z.string(),
  hiredAt: z.string(),
}) satisfies z.ZodType<Wire<CrewRosterView>>

/** CrewTicketView row of every crew.board response. */
export const crewTicketViewSchema = z.object({
  id: crewTicketIdSchema,
  workspaceId: workspaceIdSchema,
  title: z.string(),
  objective: z.string(),
  role: crewRoleSchema,
  status: crewTicketStatusSchema,
  assigneeSessionId: sessionIdSchema.optional(),
  evidence: z.string().optional(),
  summary: z.string().optional(),
  prUrl: z.string().optional(),
  verdictRationale: z.string().optional(),
  blockedReason: z.string().optional(),
  citesMessageIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<Wire<CrewTicketView>>

/** crew.board request payload. */
export const crewBoardRequestSchema = z.object({
  workspaceId: workspaceIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'crew.board'>>>

/** crew.board response value. */
export const crewBoardValueSchema = z.object({
  roster: z.array(crewRosterViewSchema),
  tickets: z.array(crewTicketViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'crew.board'>>>
