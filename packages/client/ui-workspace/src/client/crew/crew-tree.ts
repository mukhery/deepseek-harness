/**
 * Pure derivations behind the Crew panel: column grouping (mirrors
 * `tree.ts`'s session-grouping derivations) and the escalation-banner
 * correlation heuristic.
 */
import type {
  CrewRole, CrewRosterView, CrewTicketId, CrewTicketStatus, CrewTicketView,
  SessionId, SessionListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'

/** Fixed column order: the crew ticket lifecycle's every status, once each. */
export const CREW_COLUMN_ORDER: readonly CrewTicketStatus[] = [
  'open', 'assigned', 'in-progress', 'in-review', 'blocked', 'done',
]

/** One ticket row, annotated with its assignee's roster label (undefined = unassigned or the label is unknown). */
export interface CrewTicketNode {
  id: CrewTicketId
  title: string
  objective: string
  role: CrewRole
  status: CrewTicketStatus
  assigneeLabel: string | undefined
  evidence: string | undefined
  summary: string | undefined
  blockedReason: string | undefined
  verdictRationale: string | undefined
  prUrl: string | undefined
}

/** One status column: its fixed key and the tickets currently in it. */
export interface CrewColumnNode {
  key: CrewTicketStatus
  tickets: readonly CrewTicketNode[]
}

function crewTicketNode(ticket: CrewTicketView, labelBySession: ReadonlyMap<SessionId, string>): CrewTicketNode {
  return {
    id: ticket.id,
    title: ticket.title,
    objective: ticket.objective,
    role: ticket.role,
    status: ticket.status,
    assigneeLabel: ticket.assigneeSessionId === undefined ? undefined : labelBySession.get(ticket.assigneeSessionId),
    evidence: ticket.evidence,
    summary: ticket.summary,
    blockedReason: ticket.blockedReason,
    verdictRationale: ticket.verdictRationale,
    prUrl: ticket.prUrl,
  }
}

/**
 * Group a workspace's crew board into fixed status columns, each ticket
 * annotated with its assignee's roster label.
 * @param board - the workspace's roster and tickets (crew.board's response value).
 * @returns one column per {@link CREW_COLUMN_ORDER} entry, in that order.
 */
export function deriveCrewColumns(
  board: { roster: readonly CrewRosterView[]; tickets: readonly CrewTicketView[] },
): readonly CrewColumnNode[] {
  const labelBySession = new Map(board.roster.map(member => [member.memberSessionId, member.label]))
  const nodes = board.tickets.map(ticket => crewTicketNode(ticket, labelBySession))
  return CREW_COLUMN_ORDER.map(status => ({
    key: status,
    tickets: nodes.filter(node => node.status === status),
  }))
}

/**
 * Escalation-banner state: the workspace's blocked tickets, plus the Director
 * session to jump to when one correlates.
 *
 * Correlation heuristic (documented, not guaranteed — see the package
 * README's Known Limitations): within the workspace, a candidate escalating
 * Director session is one whose `agentPreset === 'crew-director'` and
 * `pendingInteraction === 'question'`. A Director asking an unrelated
 * question would false-match; there is no backend ticket↔question link
 * field, by design (see the Agent Note this ships with). The banner still
 * shows whenever at least one ticket is blocked, with or without a match —
 * the human may need to open a *new* Director thread instead.
 */
export interface CrewEscalationBannerState {
  blockedTickets: readonly CrewTicketNode[]
  matchedSessionId: SessionId | undefined
}

/**
 * Derive the escalation banner state for one workspace's crew board.
 * @param board - the workspace's roster and tickets.
 * @param sessions - the runtime's session-list snapshot (for `agentPreset`/`pendingInteraction`).
 * @param workspace - the workspace view (for session membership); undefined answers no banner.
 * @returns banner state with at least one blocked ticket, or undefined when none are blocked.
 */
export function deriveEscalationBanner(
  board: { roster: readonly CrewRosterView[]; tickets: readonly CrewTicketView[] },
  sessions: SessionListState,
  workspace: WorkspaceView | undefined,
): CrewEscalationBannerState | undefined {
  const blockedTickets = deriveCrewColumns(board)
    .find(column => column.key === 'blocked')?.tickets ?? []
  if (blockedTickets.length === 0) return undefined
  const matchedSessionId = workspace?.sessionIds
    .map(sessionId => sessions.byId[sessionId])
    .find(summary => summary?.agentPreset === 'crew-director' && summary.pendingInteraction === 'question')
    ?.id
  return { blockedTickets, matchedSessionId }
}
