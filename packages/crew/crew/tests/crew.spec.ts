import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import CrewRuntime, { CrewAuthorityError, CrewTicketId, CrewTransitionError, CrewUnknownError } from '../src/index.ts'

/** Boot the real storage/domain/runtime composition over an in-memory backend. */
async function harness(pool: MemoryMediaPool = new MemoryMediaPool()) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(pool))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const fiber = await ctx.plugin(CrewRuntime)
  return { ctx, crew: ctx.crew, fiber, pool }
}

const workspace = WorkspaceId('ws-1')
const otherWorkspace = WorkspaceId('ws-2')

describe('CrewRuntime roster and tickets', () => {
  it('hires a member and lists the workspace roster', async () => {
    const { crew } = await harness()
    const member = SessionId('member-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'researcher', label: 'Researcher' })
    expect(crew.roster(workspace)).toEqual([
      expect.objectContaining({ memberSessionId: member, role: 'researcher', label: 'Researcher' }),
    ])
    expect(crew.roster(otherWorkspace)).toEqual([])
  })

  it('runs a ticket through open -> assigned -> in-progress -> in-review -> done', async () => {
    const { crew } = await harness()
    const member = SessionId('engineer-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'engineer', label: 'Engineer' })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    expect(ticket.status).toBe('open')

    await crew.assignTicket(ticket.id, member)
    expect(crew.ticket(ticket.id)?.status).toBe('assigned')
    expect(crew.ticket(ticket.id)?.assigneeSessionId).toBe(member)

    await crew.startWork(ticket.id, member)
    expect(crew.ticket(ticket.id)?.status).toBe('in-progress')

    await crew.submitForReview(ticket.id, member, 'branch: eng-1', 'Shipped X')
    expect(crew.ticket(ticket.id)?.status).toBe('in-review')
    expect(crew.ticket(ticket.id)?.evidence).toBe('branch: eng-1')

    const reviewer = SessionId('reviewer-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: reviewer, role: 'reviewer', label: 'Reviewer' })
    const done = await crew.verdict(ticket.id, reviewer, 'accept', 'looks good', 'https://example.com/pr/1')
    expect(done.status).toBe('done')
    expect(done.prUrl).toBe('https://example.com/pr/1')
  })

  it('rejects a review back to the same assignee with the rationale attached, clearing evidence', async () => {
    const { crew } = await harness()
    const member = SessionId('engineer-1')
    const reviewer = SessionId('reviewer-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'engineer', label: 'Engineer' })
    await crew.hire({ workspaceId: workspace, memberSessionId: reviewer, role: 'reviewer', label: 'Reviewer' })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    await crew.assignTicket(ticket.id, member)
    await crew.submitForReview(ticket.id, member, 'branch: eng-1', 'Shipped X')

    const reopened = await crew.verdict(ticket.id, reviewer, 'reject', 'missing tests')
    expect(reopened.status).toBe('assigned')
    expect(reopened.assigneeSessionId).toBe(member)
    expect(reopened.verdictRationale).toBe('missing tests')
    expect(reopened.evidence).toBeUndefined()
  })

  it('blocks a working ticket and reassigns it once resolved', async () => {
    const { crew } = await harness()
    const member = SessionId('engineer-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'engineer', label: 'Engineer' })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    await crew.assignTicket(ticket.id, member)
    const blocked = await crew.submitBlocked(ticket.id, member, 'needs a decision')
    expect(blocked.status).toBe('blocked')
    expect(blocked.blockedReason).toBe('needs a decision')

    const reassigned = await crew.reassignTicket(ticket.id, member)
    expect(reassigned.status).toBe('assigned')
    expect(reassigned.blockedReason).toBeUndefined()
  })

  it('rejects assigning a ticket to a member of the wrong role or workspace', async () => {
    const { crew } = await harness()
    const wrongRole = SessionId('researcher-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: wrongRole, role: 'researcher', label: 'Researcher' })
    const wrongWorkspace = SessionId('engineer-other')
    await crew.hire({
      workspaceId: otherWorkspace, memberSessionId: wrongWorkspace, role: 'engineer', label: 'Engineer',
    })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    await expect(crew.assignTicket(ticket.id, wrongRole)).rejects.toThrow(CrewAuthorityError)
    await expect(crew.assignTicket(ticket.id, wrongWorkspace)).rejects.toThrow(CrewAuthorityError)
  })

  it('rejects a mutation from a caller who is not the recorded assignee', async () => {
    const { crew } = await harness()
    const assignee = SessionId('engineer-1')
    const impostor = SessionId('engineer-2')
    await crew.hire({ workspaceId: workspace, memberSessionId: assignee, role: 'engineer', label: 'Engineer 1' })
    await crew.hire({ workspaceId: workspace, memberSessionId: impostor, role: 'engineer', label: 'Engineer 2' })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    await crew.assignTicket(ticket.id, assignee)
    await expect(crew.submitForReview(ticket.id, impostor, 'evidence', 'summary'))
      .rejects.toThrow(CrewAuthorityError)
  })

  it('rejects a transition attempted from the wrong status', async () => {
    const { crew } = await harness()
    const member = SessionId('engineer-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'engineer', label: 'Engineer' })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    // Still 'open': startWork requires 'assigned'.
    await expect(crew.startWork(ticket.id, member)).rejects.toThrow(CrewTransitionError)
  })

  it('rejects an operation naming an unknown roster member', async () => {
    const { crew } = await harness()
    await expect(crew.assignTicket(CrewTicketId('missing'), SessionId('nobody')))
      .rejects.toThrow(CrewUnknownError)
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    await expect(crew.assignTicket(ticket.id, SessionId('nobody')))
      .rejects.toThrow(CrewUnknownError)
  })

  it('rejects a transition naming an unknown ticket, for a caller that does not require roster lookup first', async () => {
    const { crew } = await harness()
    const member = SessionId('engineer-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'engineer', label: 'Engineer' })
    await expect(crew.startWork(CrewTicketId('missing'), member)).rejects.toThrow(CrewUnknownError)
  })

  it('serializes concurrent assignment attempts on the same ticket so only one wins', async () => {
    const { crew } = await harness()
    const first = SessionId('engineer-1')
    const second = SessionId('engineer-2')
    await crew.hire({ workspaceId: workspace, memberSessionId: first, role: 'engineer', label: 'Engineer 1' })
    await crew.hire({ workspaceId: workspace, memberSessionId: second, role: 'engineer', label: 'Engineer 2' })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    const results = await Promise.allSettled([
      crew.assignTicket(ticket.id, first),
      crew.assignTicket(ticket.id, second),
    ])
    const fulfilled = results.filter(result => result.status === 'fulfilled')
    const rejected = results.filter(result => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(CrewTransitionError)
  })
})

describe('CrewRuntime message pool', () => {
  it('publishes and reads back filtered by topic and workspace', async () => {
    const { crew } = await harness()
    const from = SessionId('researcher-1')
    await crew.publish({ workspaceId: workspace, topic: 'pricing', kind: 'finding', from, body: 'finding A' })
    await crew.publish({ workspaceId: workspace, topic: 'churn', kind: 'finding', from, body: 'finding B' })
    await crew.publish({ workspaceId: otherWorkspace, topic: 'pricing', kind: 'finding', from, body: 'finding C' })

    expect(crew.readPool({ workspaceId: workspace }).map(message => message.body))
      .toEqual(['finding A', 'finding B'])
    expect(crew.readPool({ workspaceId: workspace, topics: ['pricing'] }).map(message => message.body))
      .toEqual(['finding A'])
  })

  it('filters by since, inclusive', async () => {
    const { crew } = await harness()
    const from = SessionId('researcher-1')
    const first = await crew.publish({ workspaceId: workspace, topic: 't', kind: 'finding', from, body: 'first' })
    const messages = crew.readPool({ workspaceId: workspace, since: first.createdAt })
    expect(messages.map(message => message.body)).toEqual(['first'])
  })

  it('records a citing ticket id when provided', async () => {
    const { crew } = await harness()
    const from = SessionId('researcher-1')
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    const message = await crew.publish({
      workspaceId: workspace, topic: 't', kind: 'finding', from, body: 'finding', citesTicketId: ticket.id,
    })
    expect(message.citesTicketId).toBe(ticket.id)
  })
})

describe('CrewRuntime additional coverage', () => {
  it('records cited message ids when opening a ticket', async () => {
    const { crew } = await harness()
    const from = SessionId('researcher-1')
    const finding = await crew.publish({ workspaceId: workspace, topic: 't', kind: 'finding', from, body: 'f' })
    const ticket = await crew.openTicket({
      workspaceId: workspace,
      title: 'Ship X',
      objective: 'Ship X',
      role: 'engineer',
      citesMessageIds: [finding.id],
    })
    expect(ticket.citesMessageIds).toEqual([finding.id])
  })

  it('accepts a review without a PR url for a non-engineering ticket', async () => {
    const { crew } = await harness()
    const member = SessionId('researcher-1')
    const reviewer = SessionId('reviewer-1')
    await crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'researcher', label: 'Researcher' })
    await crew.hire({ workspaceId: workspace, memberSessionId: reviewer, role: 'reviewer', label: 'Reviewer' })
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'Research X', objective: 'Research X', role: 'researcher',
    })
    await crew.assignTicket(ticket.id, member)
    await crew.submitForReview(ticket.id, member, 'evidence', 'summary')
    const done = await crew.verdict(ticket.id, reviewer, 'accept', 'looks good')
    expect(done.status).toBe('done')
    expect(done.prUrl).toBeUndefined()
  })

  it('lists every ticket in a workspace', async () => {
    const { crew } = await harness()
    const first = await crew.openTicket({
      workspaceId: workspace, title: 'A', objective: 'A', role: 'engineer',
    })
    const second = await crew.openTicket({
      workspaceId: workspace, title: 'B', objective: 'B', role: 'engineer',
    })
    await crew.openTicket({ workspaceId: otherWorkspace, title: 'C', objective: 'C', role: 'engineer' })
    expect(crew.tickets(workspace).map(ticket => ticket.id).sort())
      .toEqual([first.id, second.id].sort())
  })

  it('closes the domain when the runtime plugin is disposed', async () => {
    const { crew, fiber } = await harness()
    const ticket = await crew.openTicket({
      workspaceId: workspace, title: 'A', objective: 'A', role: 'engineer',
    })
    expect(crew.ticket(ticket.id)).toBeDefined()
    await fiber.dispose()
  })

  it('reloads roster, ticket, and message records across a simulated process restart', async () => {
    const first = await harness()
    const member = SessionId('engineer-1')
    await first.crew.hire({ workspaceId: workspace, memberSessionId: member, role: 'engineer', label: 'Engineer' })
    const ticket = await first.crew.openTicket({
      workspaceId: workspace, title: 'Ship X', objective: 'Ship X', role: 'engineer',
    })
    await first.crew.publish({
      workspaceId: workspace, topic: 't', kind: 'finding', from: member, body: 'finding', citesTicketId: ticket.id,
    })
    await first.fiber.dispose()

    const second = await harness(first.pool)
    expect(second.crew.roster(workspace)).toEqual([expect.objectContaining({ memberSessionId: member })])
    expect(second.crew.ticket(ticket.id)).toEqual(ticket)
    expect(second.crew.readPool({ workspaceId: workspace })).toEqual([
      expect.objectContaining({ body: 'finding', citesTicketId: ticket.id }),
    ])
  })
})
