import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import CrewRuntime from '@deepseek-ai/dsh-crew'
import type { HostFrame } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`crew-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

async function nextHostFrame(
  stream: AsyncIterator<RpcRequest<HostFrame>>,
): Promise<RpcRequest<HostFrame>> {
  const next = await stream.next()
  if (next.done === true) throw new Error('Host stream ended before the expected increment')
  return next.value
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/**
 * Compose the API over real Session, Agent, Storage, Domain, Workspace, and
 * Crew services — the "product-visible plugins require a non-unit
 * REAL-composition test" rule (packages/AGENTS.md), not a hand-built
 * `ctx.plugin()` mock. `crewMounted` lets one test omit the crew plugin
 * entirely, proving the optional-service reads on the host side.
 */
async function harness(crewMounted = true) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-crew-')))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)
  if (crewMounted) await ctx.plugin(CrewRuntime)

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  ctx.provide('directoryPicker', { capability: () => ({ kind: 'native', pick: async () => null }) } as never)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
  })
  return { api, ctx, root }
}

describe('crew.board', () => {
  it('reads an empty board for a workspace with no hired crew', async () => {
    const { api, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: root }))).workspace
    expect(expectOk(await api.crew.board(request({ workspaceId: workspace.workspaceId }))))
      .toEqual({ roster: [], tickets: [] })
  })

  it('answers empty rather than failing when ctx.crew is not mounted', async () => {
    const { api, root } = await harness(false)
    const workspace = expectOk(await api.workspace.create(request({ path: root }))).workspace
    expect(expectOk(await api.crew.board(request({ workspaceId: workspace.workspaceId }))))
      .toEqual({ roster: [], tickets: [] })
  })

  it('projects hired roster members and opened/assigned/blocked tickets', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: root }))).workspace
    const engineerId = SessionId('session-engineer')
    ctx.sessions.create(engineerId, {})

    await ctx.crew.hire({
      workspaceId: workspace.workspaceId,
      memberSessionId: engineerId,
      role: 'engineer',
      label: 'Engineer #1',
    })
    const ticket = await ctx.crew.openTicket({
      workspaceId: workspace.workspaceId,
      title: 'Fix the bug',
      objective: 'Make the tests pass',
      role: 'engineer',
    })
    await ctx.crew.assignTicket(ticket.id, engineerId)
    await ctx.crew.submitBlocked(ticket.id, engineerId, 'need human input')

    const board = expectOk(await api.crew.board(request({ workspaceId: workspace.workspaceId })))
    expect(board.roster).toMatchObject([
      { memberSessionId: engineerId, workspaceId: workspace.workspaceId, role: 'engineer', label: 'Engineer #1' },
    ])
    expect(typeof board.roster[0]?.hiredAt).toBe('string')
    expect(board.tickets).toMatchObject([
      { id: ticket.id, title: 'Fix the bug', status: 'blocked', blockedReason: 'need human input', assigneeSessionId: engineerId },
    ])
  })

  it('scopes the board to the requested workspace only', async () => {
    const { api, ctx, root } = await harness()
    mkdirSync(join(root, 'one'))
    mkdirSync(join(root, 'two'))
    const one = expectOk(await api.workspace.create(request({ path: join(root, 'one') }))).workspace
    const two = expectOk(await api.workspace.create(request({ path: join(root, 'two') }))).workspace
    const memberOne = SessionId('session-member-one')
    ctx.sessions.create(memberOne, {})
    await ctx.crew.hire({ workspaceId: one.workspaceId, memberSessionId: memberOne, role: 'researcher', label: 'R1' })

    expect(expectOk(await api.crew.board(request({ workspaceId: one.workspaceId }))).roster).toHaveLength(1)
    expect(expectOk(await api.crew.board(request({ workspaceId: two.workspaceId }))).roster).toHaveLength(0)
  })
})

describe('Host host/crew-board-changed increments', () => {
  it('pushes the full board for the affected workspace on every roster or ticket commit, never before', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: root }))).workspace
    const memberId = SessionId('session-reviewer')
    ctx.sessions.create(memberId, {})

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()

    const hired = nextHostFrame(stream)
    await ctx.crew.hire({ workspaceId: workspace.workspaceId, memberSessionId: memberId, role: 'reviewer', label: 'Reviewer' })
    expect(await hired).toMatchObject({
      payload: {
        type: 'host/crew-board-changed',
        workspaceId: workspace.workspaceId,
        roster: [{ memberSessionId: memberId, role: 'reviewer' }],
        tickets: [],
      },
    })

    const opened = nextHostFrame(stream)
    const ticket = await ctx.crew.openTicket({
      workspaceId: workspace.workspaceId, title: 'Review PR', objective: 'sign off', role: 'reviewer',
    })
    expect(await opened).toMatchObject({
      payload: {
        type: 'host/crew-board-changed',
        workspaceId: workspace.workspaceId,
        tickets: [{ id: ticket.id, status: 'open' }],
      },
    })
    abort.abort()
  })

  it('never fires for the crew message pool (out of scope for this projection)', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: root }))).workspace
    const memberId = SessionId('session-publisher')
    ctx.sessions.create(memberId, {})
    await ctx.crew.hire({ workspaceId: workspace.workspaceId, memberSessionId: memberId, role: 'researcher', label: 'R' })

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    await ctx.crew.publish({
      workspaceId: workspace.workspaceId, topic: 'status', kind: 'finding', from: memberId, body: 'found something',
    })
    // Publish alone must not push a board frame; a subsequent roster hire
    // proves the stream is still alive and observing, not merely quiet. The
    // hire's own session-created increment (host/session-added) lands first.
    const sessionAdded = nextHostFrame(stream)
    const hired = nextHostFrame(stream)
    const otherId = SessionId('session-second')
    ctx.sessions.create(otherId, {})
    await ctx.crew.hire({ workspaceId: workspace.workspaceId, memberSessionId: otherId, role: 'strategist', label: 'S' })
    expect(await sessionAdded).toMatchObject({ payload: { type: 'host/session-added', sessionId: otherId } })
    expect(await hired).toMatchObject({ payload: { type: 'host/crew-board-changed' } })
    abort.abort()
  })
})
