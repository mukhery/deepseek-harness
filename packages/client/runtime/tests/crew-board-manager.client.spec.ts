import { describe, expect, it } from 'vitest'
import type { CrewRosterView, CrewTicketView, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import { CrewBoardManager } from '../src/client/crew/manager.ts'
import { deferred, err, FakeApiClient, ok } from './fake-api.client.ts'

const wid = (id: string): WorkspaceId => id as WorkspaceId

function roster(memberSessionId: string, workspaceId: string): CrewRosterView {
  return {
    memberSessionId: memberSessionId as never,
    workspaceId: wid(workspaceId),
    role: 'engineer',
    label: 'Engineer #1',
    hiredAt: '2026-08-01T00:00:00.000Z',
  }
}

function ticket(id: string, workspaceId: string, status: CrewTicketView['status'] = 'open'): CrewTicketView {
  return {
    id: id as never,
    workspaceId: wid(workspaceId),
    title: 'Fix it',
    objective: 'Make it work',
    role: 'engineer',
    status,
    citesMessageIds: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  }
}

describe('CrewBoardManager', () => {
  it('pulls one workspace on ensure and answers idempotently while it is already fetched', async () => {
    const api = new FakeApiClient()
    api.onCrewBoard = () => Promise.resolve(ok({ roster: [roster('s1', 'w1')], tickets: [ticket('t1', 'w1')] }))
    const manager = new CrewBoardManager(api)

    manager.ensure(wid('w1'))
    await manager.refresh(wid('w1'))
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]).toMatchObject({
      phase: 'ready', state: 'idle', roster: [{ memberSessionId: 's1' }], tickets: [{ id: 't1' }],
    })
    expect(api.callsOf('crew.board')).toHaveLength(1)

    // A second ensure() on an already-fetched workspace is a no-op — no second call.
    manager.ensure(wid('w1'))
    expect(api.callsOf('crew.board')).toHaveLength(1)
  })

  it('single-flights refresh and keeps workspaces independent', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onCrewBoard']>>>()
    api.onCrewBoard = payload => (payload as { workspaceId: string }).workspaceId === 'w1'
      ? gate.promise
      : Promise.resolve(ok({ roster: [], tickets: [] }))
    const manager = new CrewBoardManager(api)

    const first = manager.refresh(wid('w1'))
    const second = manager.refresh(wid('w1'))
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]?.state).toBe('loading')
    await manager.refresh(wid('w2'))
    expect(manager.getSnapshot().byWorkspaceId['w2' as WorkspaceId]).toMatchObject({ phase: 'ready', state: 'idle' })
    // w1's own pull is still pending: the second workspace's completion must not resolve it.
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]?.state).toBe('loading')

    gate.resolve(ok({ roster: [roster('s1', 'w1')], tickets: [] }))
    await Promise.all([first, second])
    expect(api.callsOf('crew.board').filter(call => (call as { workspaceId: string }).workspaceId === 'w1')).toHaveLength(1)
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]).toMatchObject({ phase: 'ready', state: 'idle' })
  })

  it('exposes result and transport failures independently of readiness', async () => {
    const api = new FakeApiClient()
    api.onCrewBoard = () => Promise.resolve(err({ code: 'internal', message: 'down', details: {} }))
    const manager = new CrewBoardManager(api)
    await manager.refresh(wid('w1'))
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]).toMatchObject({
      phase: 'ready', state: 'error', error: { message: 'down' },
    })

    api.onCrewBoard = () => Promise.reject(new Error('wire down'))
    await manager.refresh(wid('w2'))
    expect(manager.getSnapshot().byWorkspaceId['w2' as WorkspaceId]).toMatchObject({
      phase: 'ready', state: 'error', error: { message: 'wire down' },
    })
  })

  it('replaces a workspace board wholesale on host/crew-board-changed (never a merge)', () => {
    const api = new FakeApiClient()
    const manager = new CrewBoardManager(api)
    manager.handleHostEnvelope({
      rpcId: 'frame-1' as never,
      payload: {
        type: 'host/crew-board-changed', workspaceId: wid('w1'),
        roster: [roster('s1', 'w1')], tickets: [ticket('t1', 'w1', 'blocked')],
      },
    })
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]).toMatchObject({
      phase: 'ready', state: 'idle', tickets: [{ id: 't1', status: 'blocked' }],
    })
    manager.handleHostEnvelope({
      rpcId: 'frame-2' as never,
      payload: { type: 'host/crew-board-changed', workspaceId: wid('w1'), roster: [], tickets: [] },
    })
    // Full replace: the previously-pushed roster/ticket is gone, not merged with the empty push.
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]).toMatchObject({ roster: [], tickets: [] })
  })

  it('a frame landing mid-refresh outranks that refresh\'s own (now-stale) response', async () => {
    const api = new FakeApiClient()
    const gate = deferred<Awaited<ReturnType<FakeApiClient['onCrewBoard']>>>()
    api.onCrewBoard = () => gate.promise
    const manager = new CrewBoardManager(api)

    const pending = manager.refresh(wid('w1'))
    manager.handleHostEnvelope({
      rpcId: 'frame-1' as never,
      payload: {
        type: 'host/crew-board-changed', workspaceId: wid('w1'),
        roster: [], tickets: [ticket('t-newer', 'w1', 'in-review')],
      },
    })
    // The frame's own install already applies immediately, independent of the pending refresh.
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]?.tickets).toEqual([
      expect.objectContaining({ id: 't-newer' }),
    ])
    gate.resolve(ok({ roster: [], tickets: [ticket('t-older', 'w1', 'open')] }))
    await pending
    // The refresh's stale response must not roll back the frame's newer snapshot.
    expect(manager.getSnapshot().byWorkspaceId['w1' as WorkspaceId]?.tickets).toEqual([
      expect.objectContaining({ id: 't-newer' }),
    ])
  })

  it('re-pulls every previously shown workspace on reconnect', async () => {
    const api = new FakeApiClient()
    api.onCrewBoard = () => Promise.resolve(ok({ roster: [], tickets: [] }))
    const manager = new CrewBoardManager(api)
    await manager.refresh(wid('w1'))
    await manager.refresh(wid('w2'))
    expect(api.callsOf('crew.board')).toHaveLength(2)

    manager.handleConnected()
    await Promise.resolve()
    await Promise.resolve()
    expect(api.callsOf('crew.board')).toHaveLength(4)
  })
})
