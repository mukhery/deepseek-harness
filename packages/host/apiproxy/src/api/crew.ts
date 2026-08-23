/**
 * crew domain contract. Wire projection of the workspace-scoped roster/ticket
 * ledger (`ctx.crew`, @deepseek-ai/dsh-crew): read-only — every crew mutation
 * stays tool-mediated (`crew_hire`/`crew_assign_ticket`/`crew_verdict`/etc.),
 * never through this RPC. `CrewRole`/`CrewTicketStatus` are re-declared here
 * rather than imported from dsh-crew: api/ must stay browser-importable with
 * zero host-package dependencies, same reasoning workspace.ts documents for
 * `WorkspaceId`. The message pool (`messages` table) is out of scope for this
 * surface — only roster and tickets project onto the wire.
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { WorkspaceId } from './workspace.ts'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * Fixed crew role vocabulary, mirrored from `CrewRole` (@deepseek-ai/dsh-crew/src/types.ts).
 * Closed, protocol-constant: role identity is load-bearing to ticket-transition
 * and tool-authority rules on the host side, not a deployment-configurable value.
 */
export type CrewRole = 'director' | 'researcher' | 'strategist' | 'engineer' | 'reviewer'

/**
 * Ticket lifecycle, mirrored from `CrewTicketStatus`. `done` is reachable only
 * through the host's `crew_verdict` tool accepting an `in-review` ticket.
 */
export type CrewTicketStatus = 'open' | 'assigned' | 'in-progress' | 'in-review' | 'done' | 'blocked'

/** Identifies one durable ticket record (generated uuid, opaque on the wire). */
export type CrewTicketId = Branded<'CrewTicketId'>

/** One roster row: the identity projection of `CrewRosterRecord` every crew.board value carries. */
export interface CrewRosterView {
  memberSessionId: SessionId
  workspaceId: WorkspaceId
  role: CrewRole
  label: string
  hiredAt: string
}

/** One ticket row: the identity projection of `CrewTicketRecord` every crew.board value carries. */
export interface CrewTicketView {
  id: CrewTicketId
  workspaceId: WorkspaceId
  title: string
  objective: string
  role: CrewRole
  status: CrewTicketStatus
  assigneeSessionId?: SessionId
  evidence?: string
  summary?: string
  prUrl?: string
  verdictRationale?: string
  blockedReason?: string
  citesMessageIds: string[]
  createdAt: string
  updatedAt: string
}

/** Crew-domain unary methods (the map keys crew.* of RpcMethodMap). */
export interface CrewApi {
  /**
   * Reads the complete roster and ticket ledger for one workspace. A
   * workspace with no hired crew returns empty arrays rather than an error —
   * `ctx.crew` is an optional host service (a composition without
   * `@deepseek-ai/dsh-crew` mounted also answers empty, never a failure).
   */
  board(request: RpcRequest<{ workspaceId: WorkspaceId }>):
  Promise<RpcResponse<{ roster: CrewRosterView[]; tickets: CrewTicketView[] }>>
}
