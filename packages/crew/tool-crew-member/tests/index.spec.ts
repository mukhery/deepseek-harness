import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

const workspace = WorkspaceId('ws-1')
const member = SessionId('member-1')

/** Minimal fake ctx: captures registered tool definitions and stubs ctx.crew/workspaceRegistry. */
function harness(cwd: string | undefined) {
  const tools = new Map<string, ToolDefinition>()
  const crew = {
    submitForReview: vi.fn(async () => ({ id: 't1', status: 'in-review', evidence: 'e', summary: 's' })),
    submitBlocked: vi.fn(async () => ({ id: 't1', status: 'blocked', blockedReason: 'r' })),
    publish: vi.fn(async () => ({ id: 'm1', workspaceId: workspace, topic: 't', kind: 'finding', body: 'b' })),
    readPool: vi.fn(() => [{ id: 'm1', workspaceId: workspace, topic: 't', kind: 'finding', body: 'b' }]),
  }
  const workspaceRegistry = { resolveByPath: vi.fn(async () => cwd === undefined ? undefined : { id: workspace }) }
  const ctx = {
    tools: { register: (def: ToolDefinition) => { tools.set(def.name, def) } },
    crew,
    workspaceRegistry,
  } as never
  apply(ctx)
  const agent = cwd === undefined
    ? undefined
    : { id: member, session: { header: { cwd } } } as unknown as Agent
  const exec = (overrides: Partial<ToolRunContext> = {}): ToolRunContext => ({
    agent,
    signal: new AbortController().signal,
    callId: 'c1',
    name: 'x',
    arguments: {},
    token: 't1',
    deferContext: () => {},
    concludeTurn: () => {},
    ...overrides,
  }) as unknown as ToolRunContext
  return { tools, crew, workspaceRegistry, exec }
}

describe('tool-crew-member', () => {
  it('crew_report submits for review, stripping undefined fields', async () => {
    const { tools, crew, exec } = harness('/proj')
    const result = await tools.get('crew_report')!.execute(
      { ticket_id: 't1', outcome: 'ready_for_review', evidence: 'e', summary: 's' }, exec(),
    )
    expect(crew.submitForReview).toHaveBeenCalledWith('t1', member, 'e', 's')
    expect(result).toEqual({ id: 't1', status: 'in-review', evidence: 'e', summary: 's' })
  })

  it('crew_report rejects ready_for_review without evidence/summary', async () => {
    const { tools, exec } = harness('/proj')
    await expect(tools.get('crew_report')!.execute({ ticket_id: 't1', outcome: 'ready_for_review' }, exec()))
      .rejects.toThrow(/evidence and summary/)
  })

  it('crew_report submits blocked, and rejects without a reason', async () => {
    const { tools, crew, exec } = harness('/proj')
    const result = await tools.get('crew_report')!.execute({ ticket_id: 't1', outcome: 'blocked', reason: 'r' }, exec())
    expect(crew.submitBlocked).toHaveBeenCalledWith('t1', member, 'r')
    expect(result).toEqual({ id: 't1', status: 'blocked', blockedReason: 'r' })
    await expect(tools.get('crew_report')!.execute({ ticket_id: 't1', outcome: 'blocked' }, exec()))
      .rejects.toThrow(/reason is required/)
  })

  it('crew_publish forwards to ctx.crew.publish, with and without an optional citing ticket', async () => {
    const { tools, crew, exec } = harness('/proj')
    await tools.get('crew_publish')!.execute({ topic: 't', kind: 'finding', body: 'b', cites_ticket_id: 't1' }, exec())
    expect(crew.publish).toHaveBeenCalledWith({
      workspaceId: workspace, topic: 't', kind: 'finding', from: member, body: 'b', citesTicketId: 't1',
    })
    await tools.get('crew_publish')!.execute({ topic: 't', kind: 'finding', body: 'b' }, exec())
    expect(crew.publish).toHaveBeenLastCalledWith({ workspaceId: workspace, topic: 't', kind: 'finding', from: member, body: 'b' })
  })

  it('crew_read_pool forwards filters (present and absent) and wraps the result', async () => {
    const { tools, crew, exec } = harness('/proj')
    const result = await tools.get('crew_read_pool')!.execute({ topics: ['t'], since: '2026-01-01' }, exec())
    expect(crew.readPool).toHaveBeenCalledWith({ workspaceId: workspace, topics: ['t'], since: '2026-01-01' })
    expect(result).toEqual({ messages: [{ id: 'm1', workspaceId: workspace, topic: 't', kind: 'finding', body: 'b' }] })
    await tools.get('crew_read_pool')!.execute({}, exec())
    expect(crew.readPool).toHaveBeenLastCalledWith({ workspaceId: workspace })
  })

  it('every tool rejects without a calling agent, a cwd, or a resolvable workspace', async () => {
    const { tools, exec } = harness(undefined)
    await expect(tools.get('crew_read_pool')!.execute({}, exec())).rejects.toThrow(/calling agent/)

    const { tools: tools2, exec: exec2 } = harness(undefined)
    await expect(tools2.get('crew_read_pool')!.execute({}, exec2({
      agent: { id: member, session: { header: {} } } as unknown as Agent,
    }))).rejects.toThrow(/working directory/)

    const { tools: tools3, exec: exec3 } = harness(undefined)
    await expect(tools3.get('crew_read_pool')!.execute({}, exec3({
      agent: { id: member, session: { header: { cwd: '/unregistered' } } } as unknown as Agent,
    }))).rejects.toThrow(/no workspace is registered/)
  })

  it('presents each tool call with the expected card kind and renders its output as text', async () => {
    const { tools } = harness('/proj')
    expect(tools.get('crew_report')!.presentCall!({ ticket_id: 't1', outcome: 'blocked' })).toMatchObject({ kind: 'other' })
    expect(tools.get('crew_publish')!.presentCall!({ topic: 't', kind: 'finding', body: 'b' })).toMatchObject({ kind: 'other' })
    expect(tools.get('crew_read_pool')!.presentCall!({})).toMatchObject({ kind: 'read' })
    expect(tools.get('crew_read_pool')!.output.render({}, { messages: [] })).toEqual([
      { type: 'text', text: '{"messages":[]}' },
    ])
  })
})
