import { describe, expect, it } from 'vitest'
import type {
  CrewRosterView, CrewTicketView, SessionId, SessionListState, SessionSummary, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { CREW_COLUMN_ORDER, deriveCrewColumns, deriveEscalationBanner } from '../src/client/crew/crew-tree.ts'

const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId

function roster(memberSessionId: string, workspaceId: string, label = 'Engineer #1'): CrewRosterView {
  return {
    memberSessionId: sid(memberSessionId), workspaceId: wid(workspaceId), role: 'engineer', label,
    hiredAt: '2026-08-01T00:00:00.000Z',
  }
}

function ticket(
  id: string, workspaceId: string, status: CrewTicketView['status'], overrides: Partial<CrewTicketView> = {},
): CrewTicketView {
  return {
    id: id as never, workspaceId: wid(workspaceId), title: `Ticket ${id}`, objective: 'Do the thing',
    role: 'engineer', status, citesMessageIds: [],
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function sessionList(items: readonly SessionSummary[]): SessionListState {
  return {
    ids: items.map(item => item.id),
    byId: Object.fromEntries(items.map(item => [item.id, item])),
    current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

function workspace(id: string, sessionIds: string[]): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title: id,
    sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('deriveCrewColumns', () => {
  it('groups tickets into every fixed column, even when empty', () => {
    const columns = deriveCrewColumns({ roster: [], tickets: [] })
    expect(columns.map(column => column.key)).toEqual([...CREW_COLUMN_ORDER])
    expect(columns.every(column => column.tickets.length === 0)).toBe(true)
  })

  it('sorts tickets into their status column and annotates the assignee label', () => {
    const board = {
      roster: [roster('eng-1', 'w1', 'Engineer #1')],
      tickets: [
        ticket('t-open', 'w1', 'open'),
        ticket('t-assigned', 'w1', 'assigned', { assigneeSessionId: sid('eng-1') }),
        ticket('t-blocked', 'w1', 'blocked', { assigneeSessionId: sid('eng-1'), blockedReason: 'need input' }),
      ],
    }
    const columns = deriveCrewColumns(board)
    expect(columns.find(c => c.key === 'open')!.tickets.map(t => t.id)).toEqual(['t-open'])
    const assignedColumn = columns.find(c => c.key === 'assigned')!.tickets
    expect(assignedColumn).toHaveLength(1)
    expect(assignedColumn[0]).toMatchObject({ id: 't-assigned', assigneeLabel: 'Engineer #1' })
    const blockedColumn = columns.find(c => c.key === 'blocked')!.tickets
    expect(blockedColumn[0]).toMatchObject({ id: 't-blocked', blockedReason: 'need input' })
  })

  it('leaves assigneeLabel undefined for an unknown or absent assignee', () => {
    const board = {
      roster: [],
      tickets: [
        ticket('t-unassigned', 'w1', 'open'),
        ticket('t-unknown-assignee', 'w1', 'assigned', { assigneeSessionId: sid('ghost') }),
      ],
    }
    const columns = deriveCrewColumns(board)
    expect(columns.find(c => c.key === 'open')!.tickets[0]!.assigneeLabel).toBeUndefined()
    expect(columns.find(c => c.key === 'assigned')!.tickets[0]!.assigneeLabel).toBeUndefined()
  })
})

describe('deriveEscalationBanner', () => {
  it('answers undefined when no ticket is blocked', () => {
    const board = { roster: [], tickets: [ticket('t1', 'w1', 'open')] }
    expect(deriveEscalationBanner(board, sessionList([]), workspace('w1', []))).toBeUndefined()
  })

  it('lists every blocked ticket regardless of a matching session', () => {
    const board = {
      roster: [],
      tickets: [
        ticket('t1', 'w1', 'blocked', { blockedReason: 'first blocker' }),
        ticket('t2', 'w1', 'blocked', { blockedReason: 'second blocker' }),
        ticket('t3', 'w1', 'open'),
      ],
    }
    const banner = deriveEscalationBanner(board, sessionList([]), workspace('w1', []))
    expect(banner?.blockedTickets.map(t => t.id)).toEqual(['t1', 't2'])
    expect(banner?.matchedSessionId).toBeUndefined()
  })

  it('matches a Director session mid-question within the same workspace', () => {
    const board = { roster: [], tickets: [ticket('t1', 'w1', 'blocked')] }
    const director: SessionSummary = {
      id: sid('director'), displayTitle: 'Director', running: true, blank: false, updatedAt: 1,
      agentPreset: 'crew-director', pendingInteraction: 'question',
    }
    const banner = deriveEscalationBanner(
      board, sessionList([director]), workspace('w1', ['director']),
    )
    expect(banner?.matchedSessionId).toBe(sid('director'))
  })

  it('does not match a Director session outside the workspace, or one not mid-question', () => {
    const board = { roster: [], tickets: [ticket('t1', 'w1', 'blocked')] }
    const outsideDirector: SessionSummary = {
      id: sid('outside'), displayTitle: 'Director', running: true, blank: false, updatedAt: 1,
      agentPreset: 'crew-director', pendingInteraction: 'question',
    }
    const idleDirector: SessionSummary = {
      id: sid('idle'), displayTitle: 'Director', running: false, blank: false, updatedAt: 1,
      agentPreset: 'crew-director',
    }
    // outsideDirector is not accounted by w1's sessionIds.
    const banner1 = deriveEscalationBanner(board, sessionList([outsideDirector]), workspace('w1', []))
    expect(banner1?.matchedSessionId).toBeUndefined()
    // idleDirector is in-workspace but has no pending question.
    const banner2 = deriveEscalationBanner(board, sessionList([idleDirector]), workspace('w1', ['idle']))
    expect(banner2?.matchedSessionId).toBeUndefined()
  })

  it('answers no match when the workspace itself is unresolved (e.g. an ungrouped selection)', () => {
    const board = { roster: [], tickets: [ticket('t1', 'w1', 'blocked')] }
    const banner = deriveEscalationBanner(board, sessionList([]), undefined)
    expect(banner?.blockedTickets).toHaveLength(1)
    expect(banner?.matchedSessionId).toBeUndefined()
  })
})
