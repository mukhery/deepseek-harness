import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import * as CrewInvariant from '../src/invariant.ts'
import type { CrewRosterRecord } from '../src/index.ts'

const workspace = WorkspaceId('ws-1')

/** Boot the invariant service plus the companion over a stubbed runtime knowing exactly `rosterIds`. */
async function setup(rosterIds: string[]): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry)
  const roster: CrewRosterRecord[] = rosterIds.map(id => ({
    memberSessionId: SessionId(id),
    workspaceId: workspace,
    role: 'engineer',
    label: id,
    hiredAt: '2026-01-01T00:00:00.000Z',
  }))
  ctx.provide('crew', { roster: () => roster })
  await ctx.plugin(CrewInvariant)
  return ctx
}

const ticketPut = (assigneeSessionId?: string): DomainChanged => ({
  domain: 'crew',
  table: 'tickets',
  key: 't1',
  operation: 'put',
  value: {
    id: 't1',
    workspaceId: workspace,
    title: 'title',
    objective: 'objective',
    role: 'engineer',
    status: 'assigned',
    citesMessageIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...(assigneeSessionId === undefined ? {} : { assigneeSessionId }),
  },
})

describe('crew roster/ticket invariant', () => {
  it('accepts a ticket with no assignee', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', ticketPut()) }).not.toThrow()
  })

  it('accepts a ticket whose assignee is on the workspace roster', async () => {
    const ctx = await setup(['engineer-1'])
    expect(() => { ctx.emit('domain/changed', ticketPut('engineer-1')) }).not.toThrow()
  })

  it('fails a ticket whose assignee is not on the workspace roster', async () => {
    const ctx = await setup([])
    expect(() => { ctx.emit('domain/changed', ticketPut('engineer-1')) })
      .toThrow(/is not on workspace/)
  })

  it('ignores other domains, tables, and delete operations', async () => {
    const ctx = await setup([])
    expect(() => {
      ctx.emit('domain/changed', { domain: 'other', table: 'tickets', key: 't1', operation: 'put', value: {} })
    }).not.toThrow()
    expect(() => {
      ctx.emit('domain/changed', { domain: 'crew', table: 'roster', key: 'm1', operation: 'put', value: {} })
    }).not.toThrow()
    expect(() => {
      ctx.emit('domain/changed', { domain: 'crew', table: 'tickets', key: 't1', operation: 'deleted' })
    }).not.toThrow()
  })
})
