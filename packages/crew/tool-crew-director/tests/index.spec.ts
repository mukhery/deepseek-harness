import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'
import type { Config } from '../src/index.ts'

const workspace = WorkspaceId('ws-1')
const director = SessionId('director-1')
const child = SessionId('child-1')

function harness(config: Config = {}, withAgent = true) {
  const tools = new Map<string, ToolDefinition>()
  const crew = {
    hire: vi.fn(async () => ({ memberSessionId: child, role: 'researcher', label: 'Researcher' })),
    openTicket: vi.fn(async () => ({ id: 't1', status: 'open' })),
    assignTicket: vi.fn(async () => ({ id: 't1', status: 'assigned', objective: 'do it' })),
    roster: vi.fn(() => [{ memberSessionId: child, role: 'researcher', label: 'Researcher' }]),
    tickets: vi.fn(() => [{ id: 't1', status: 'open' }]),
  }
  const subagents = {
    startContinuable: vi.fn(async (_spec: unknown) => ({ childId: child, messageId: 'm1' })),
    followup: vi.fn(async (..._args: unknown[]) => 'm2'),
  }
  const workspaceRegistry = { resolveByPath: vi.fn(async () => ({ id: workspace })) }
  const ctx = {
    tools: { register: (def: ToolDefinition) => { tools.set(def.name, def) } },
    crew,
    subagents,
    workspaceRegistry,
  } as never
  apply(ctx, config)
  const agent = withAgent
    ? { id: director, session: { header: { cwd: '/proj' } } } as unknown as Agent
    : undefined
  const exec = (): ToolRunContext => ({
    agent,
    signal: new AbortController().signal,
    callId: 'c1',
    name: 'x',
    arguments: {},
    token: 't1',
    deferContext: () => {},
    concludeTurn: () => {},
  }) as unknown as ToolRunContext
  return { tools, crew, subagents, exec }
}

describe('tool-crew-director', () => {
  it('crew_hire starts a continuable child with a role toolFilter and records the roster', async () => {
    const { tools, crew, subagents, exec } = harness()
    const result = await tools.get('crew_hire')!.execute({ role: 'researcher', label: 'Researcher' }, exec())
    const call = subagents.startContinuable.mock.calls[0]![0] as {
      provider: string
      label: string
      request: { toolFilter: { allow: string[] } }
    }
    expect(call.provider).toBe('spawn')
    expect(call.label).toBe('Researcher')
    expect(call.request.toolFilter).toEqual({ allow: ['crew_report', 'crew_publish', 'crew_read_pool'] })
    expect(crew.hire).toHaveBeenCalledWith({ workspaceId: workspace, memberSessionId: child, role: 'researcher', label: 'Researcher' })
    expect(result).toEqual({ memberSessionId: child, role: 'researcher', label: 'Researcher' })
  })

  it('crew_hire gives a strategist crew_open_ticket and honors configured extra tools', async () => {
    const { tools, subagents, exec } = harness({ roleToolAllow: { engineer: ['bash'] } })
    await tools.get('crew_hire')!.execute({ role: 'strategist', label: 'Strategist' }, exec())
    const strategistAllow = (subagents.startContinuable.mock.calls[0]![0] as {
      request: { toolFilter: { allow: string[] } }
    }).request.toolFilter.allow
    expect(strategistAllow).toEqual(['crew_report', 'crew_publish', 'crew_read_pool', 'crew_open_ticket'])

    await tools.get('crew_hire')!.execute({ role: 'engineer', label: 'Engineer' }, exec())
    const engineerAllow = (subagents.startContinuable.mock.calls[1]![0] as {
      request: { toolFilter: { allow: string[] } }
    }).request.toolFilter.allow
    expect(engineerAllow).toEqual(['crew_report', 'crew_publish', 'crew_read_pool', 'bash'])
  })

  it('crew_open_ticket forwards fields, with and without cited message ids', async () => {
    const { tools, crew, exec } = harness()
    await tools.get('crew_open_ticket')!.execute(
      { title: 'T', objective: 'O', role: 'researcher', cites_message_ids: ['m1'] }, exec(),
    )
    expect(crew.openTicket).toHaveBeenCalledWith({
      workspaceId: workspace, title: 'T', objective: 'O', role: 'researcher', citesMessageIds: ['m1'],
    })
    await tools.get('crew_open_ticket')!.execute({ title: 'T', objective: 'O', role: 'researcher' }, exec())
    expect(crew.openTicket).toHaveBeenLastCalledWith({ workspaceId: workspace, title: 'T', objective: 'O', role: 'researcher' })
  })

  it('crew_assign_ticket assigns and delivers the objective as the member\'s next turn', async () => {
    const { tools, crew, subagents, exec } = harness()
    const result = await tools.get('crew_assign_ticket')!.execute({ ticket_id: 't1', member_session_id: child }, exec())
    expect(crew.assignTicket).toHaveBeenCalledWith('t1', child)
    expect(subagents.followup).toHaveBeenCalledWith(
      expect.objectContaining({ id: director }),
      child,
      [{ type: 'text', text: 'do it' }],
      expect.objectContaining({ source: { kind: 'coordinator', form: 'relay', senderSessionId: director } }),
    )
    expect(result).toEqual({ id: 't1', status: 'assigned', objective: 'do it' })
  })

  it('crew_board returns the roster and tickets for the caller\'s workspace', async () => {
    const { tools, exec } = harness()
    const result = await tools.get('crew_board')!.execute({}, exec())
    expect(result).toEqual({
      roster: [{ memberSessionId: child, role: 'researcher', label: 'Researcher' }],
      tickets: [{ id: 't1', status: 'open' }],
    })
  })

  it('every tool rejects without a calling agent, a cwd, or a resolvable workspace', async () => {
    const { tools, exec } = harness({}, false)
    await expect(tools.get('crew_board')!.execute({}, exec())).rejects.toThrow(/calling agent/)

    const { tools: tools2 } = harness()
    const noCwd = { id: director, session: { header: {} } } as unknown as Agent
    await expect(tools2.get('crew_board')!.execute({}, {
      agent: noCwd, signal: new AbortController().signal,
    } as unknown as ToolRunContext)).rejects.toThrow(/working directory/)

    const registered = new Map<string, ToolDefinition>()
    apply({
      tools: { register: (def: ToolDefinition) => { registered.set(def.name, def) } },
      crew: {},
      subagents: {},
      workspaceRegistry: { resolveByPath: vi.fn(async () => undefined) },
    } as never, {})
    const withCwd = { id: director, session: { header: { cwd: '/unregistered' } } } as unknown as Agent
    await expect(registered.get('crew_board')!.execute({}, {
      agent: withCwd, signal: new AbortController().signal,
    } as unknown as ToolRunContext)).rejects.toThrow(/no workspace is registered/)
  })

  it('presents each tool call and renders its output as text', async () => {
    const { tools } = harness()
    expect(tools.get('crew_hire')!.presentCall!({ role: 'researcher', label: 'R' })).toMatchObject({ kind: 'other' })
    expect(tools.get('crew_open_ticket')!.presentCall!({ title: 'T', objective: 'O', role: 'researcher' }))
      .toMatchObject({ kind: 'other' })
    expect(tools.get('crew_assign_ticket')!.presentCall!({ ticket_id: 't1', member_session_id: child }))
      .toMatchObject({ kind: 'other' })
    expect(tools.get('crew_board')!.presentCall!({})).toMatchObject({ kind: 'read' })
    expect(tools.get('crew_board')!.output.render({}, { roster: [] })).toEqual([{ type: 'text', text: '{"roster":[]}' }])
  })
})
