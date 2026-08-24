// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type {
  CrewBoardsState, CrewTicketId, CrewTicketView, SessionId, SessionListState, WorkspaceId, WorkspaceListState,
  WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { WorkspaceBrowserProps } from '../src/client/contract/slots.ts'
import { CrewBoard } from '../src/client/crew/CrewBoard.tsx'
import { CrewTicketCard } from '../src/client/crew/CrewTicketCard.tsx'
import type { CrewTicketNode } from '../src/client/crew/crew-tree.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t: WorkspaceBrowserProps['t'] = makeTranslate(zh, commonZh)
const sid = (id: string): SessionId => id as SessionId
const wid = (id: string): WorkspaceId => id as WorkspaceId
const tid = (id: string): CrewTicketId => id as CrewTicketId

function sessionState(overrides: Partial<SessionListState> = {}): SessionListState {
  return {
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {},
    currentAddress: undefined, ...overrides,
  }
}

function workspaceState(items: readonly WorkspaceView[]): WorkspaceListState {
  return {
    items, archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
    recentWorkspaceId: items[0]?.workspaceId,
  }
}

function workspace(id: string, sessionIds: string[] = []): WorkspaceView {
  return {
    workspaceId: wid(id), path: `/projects/${id}`, title: id,
    sessionIds: sessionIds.map(sid), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function hook<T>(snapshot: T) {
  return function select<S>(selector: (state: T) => S): S { return selector(snapshot) }
}

function ticket(
  overrides: Omit<Partial<CrewTicketView>, 'id'> & { id: string; status: CrewTicketView['status'] },
): CrewTicketView {
  const { id, ...rest } = overrides
  return {
    workspaceId: wid('w1'), title: 'Ticket', objective: 'Objective', role: 'engineer',
    citesMessageIds: [], createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    ...rest,
    id: tid(id),
  }
}

describe('CrewBoard', () => {
  it('shows the empty state with no resolved workspace', () => {
    render(
      <CrewBoard
        workspaceId={undefined}
        ensureCrewBoard={vi.fn()}
        useCrewBoard={hook<CrewBoardsState>({ byWorkspaceId: {} })}
        useSessions={hook(sessionState())}
        useWorkspaces={hook(workspaceState([]))}
        open={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText('选择一个工作区内的会话以查看其协作团队。')).toBeTruthy()
  })

  it('ensures the board and shows a loading state while the entry is absent or pending', () => {
    const ensureCrewBoard = vi.fn()
    const { rerender } = render(
      <CrewBoard
        workspaceId={wid('w1')}
        ensureCrewBoard={ensureCrewBoard}
        useCrewBoard={hook<CrewBoardsState>({ byWorkspaceId: {} })}
        useSessions={hook(sessionState())}
        useWorkspaces={hook(workspaceState([workspace('w1')]))}
        open={vi.fn()}
        t={t}
      />,
    )
    expect(ensureCrewBoard).toHaveBeenCalledWith('w1')
    expect(screen.getByText('正在加载协作团队…')).toBeTruthy()

    rerender(
      <CrewBoard
        workspaceId={wid('w1')}
        ensureCrewBoard={ensureCrewBoard}
        useCrewBoard={hook<CrewBoardsState>({
          byWorkspaceId: { [wid('w1')]: { roster: [], tickets: [], state: 'loading', phase: 'pending', error: null } },
        })}
        useSessions={hook(sessionState())}
        useWorkspaces={hook(workspaceState([workspace('w1')]))}
        open={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText('正在加载协作团队…')).toBeTruthy()
  })

  it('renders columns and the escalation banner with a matched Director session', () => {
    const open = vi.fn()
    const director = {
      id: sid('director-1'), displayTitle: 'Director', running: false, blank: true, updatedAt: 1,
      agentPreset: 'crew-director', pendingInteraction: 'question' as const,
    }
    render(
      <CrewBoard
        workspaceId={wid('w1')}
        ensureCrewBoard={vi.fn()}
        useCrewBoard={hook<CrewBoardsState>({
          byWorkspaceId: {
            [wid('w1')]: {
              state: 'idle', phase: 'ready', error: null,
              roster: [{
                memberSessionId: sid('eng-1'), workspaceId: wid('w1'), role: 'engineer',
                label: 'Engineer #1', hiredAt: '2026-08-01T00:00:00.000Z',
              }],
              tickets: [
                ticket({ id: 't-blocked', status: 'blocked', assigneeSessionId: sid('eng-1'), blockedReason: 'stuck' }),
              ],
            },
          },
        })}
        useSessions={hook(sessionState({ ids: [director.id], byId: { [director.id]: director }, current: director.id }))}
        useWorkspaces={hook(workspaceState([workspace('w1', ['director-1'])]))}
        open={open}
        t={t}
      />,
    )
    expect(screen.getByText('受阻')).toBeTruthy()
    const cta = screen.getByRole('button', { name: '前往会话' })
    fireEvent.click(cta)
    expect(open).toHaveBeenCalledWith('director-1')
  })

  it('renders the plural escalation copy for more than one blocked ticket', () => {
    render(
      <CrewBoard
        workspaceId={wid('w1')}
        ensureCrewBoard={vi.fn()}
        useCrewBoard={hook<CrewBoardsState>({
          byWorkspaceId: {
            [wid('w1')]: {
              state: 'idle', phase: 'ready', error: null, roster: [],
              tickets: [
                ticket({ id: 't-1', status: 'blocked' }),
                ticket({ id: 't-2', status: 'blocked' }),
              ],
            },
          },
        })}
        useSessions={hook(sessionState())}
        useWorkspaces={hook(workspaceState([workspace('w1')]))}
        open={vi.fn()}
        t={t}
      />,
    )
    expect(screen.getByText('2 个工单受阻，需要你的处理。')).toBeTruthy()
    expect(screen.getByText('未找到正在等待回答的负责人会话——可能需要新建一个。')).toBeTruthy()
  })
})

describe('CrewTicketCard', () => {
  it('shows Unassigned for a ticket with no assignee', () => {
    render(<CrewTicketCard ticket={node({ id: 't1', status: 'open' })} t={t} />)
    expect(screen.getByText('未分配')).toBeTruthy()
  })

  it('shows the assignee label when assigned', () => {
    render(<CrewTicketCard ticket={node({ id: 't1', status: 'assigned', assigneeLabel: 'Engineer #1' })} t={t} />)
    expect(screen.getByText('负责人：Engineer #1')).toBeTruthy()
  })

  it('shows evidence and summary while in-review, and neither when both are absent', () => {
    const { rerender } = render(
      <CrewTicketCard
        ticket={node({ id: 't1', status: 'in-review', evidence: 'repro steps', summary: 'ready' })}
        t={t}
      />,
    )
    expect(screen.getByText(/repro steps/)).toBeTruthy()
    expect(screen.getByText(/ready/)).toBeTruthy()
    rerender(<CrewTicketCard ticket={node({ id: 't1', status: 'in-review' })} t={t} />)
    expect(screen.queryByText('证据：', { exact: false })).toBeNull()
    expect(screen.queryByText('总结：', { exact: false })).toBeNull()
  })

  it('shows the blocked reason only when present', () => {
    const { rerender } = render(
      <CrewTicketCard ticket={node({ id: 't1', status: 'blocked', blockedReason: 'need input' })} t={t} />,
    )
    expect(screen.getByText('need input')).toBeTruthy()
    rerender(<CrewTicketCard ticket={node({ id: 't1', status: 'blocked' })} t={t} />)
    expect(screen.queryByText('need input')).toBeNull()
  })

  it('shows verdict rationale and/or the PR link once done, and neither block when both are absent', () => {
    const { rerender } = render(
      <CrewTicketCard ticket={node({ id: 't1', status: 'done', verdictRationale: 'looks good' })} t={t} />,
    )
    expect(screen.getByText(/looks good/)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()

    rerender(<CrewTicketCard ticket={node({ id: 't1', status: 'done', prUrl: 'https://example.com/pr/1' })} t={t} />)
    expect(screen.getByRole('link', { name: 'https://example.com/pr/1' })).toBeTruthy()
    expect(screen.queryByText(/looks good/)).toBeNull()

    rerender(<CrewTicketCard ticket={node({ id: 't1', status: 'done' })} t={t} />)
    expect(screen.queryByRole('link')).toBeNull()
  })
})

function node(
  overrides: Omit<Partial<CrewTicketNode>, 'id'> & { id: string; status: CrewTicketNode['status'] },
): CrewTicketNode {
  const { id, ...rest } = overrides
  return {
    title: 'Ticket', objective: 'Objective', role: 'engineer',
    assigneeLabel: undefined, evidence: undefined, summary: undefined,
    blockedReason: undefined, verdictRationale: undefined, prUrl: undefined,
    ...rest,
    id: tid(id),
  }
}
