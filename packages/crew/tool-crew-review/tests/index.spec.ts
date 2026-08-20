import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

const reviewer = SessionId('reviewer-1')

function harness(withAgent = true) {
  const tools = new Map<string, ToolDefinition>()
  const crew = { verdict: vi.fn(async () => ({ id: 't1', status: 'done', prUrl: 'https://pr/1' })) }
  const ctx = { tools: { register: (def: ToolDefinition) => { tools.set(def.name, def) } }, crew } as never
  apply(ctx)
  const agent = withAgent ? { id: reviewer } as unknown as Agent : undefined
  const exec = (): ToolRunContext => ({
    agent,
    signal: new AbortController().signal,
    callId: 'c1',
    name: 'crew_verdict',
    arguments: {},
    token: 't1',
    deferContext: () => {},
    concludeTurn: () => {},
  }) as unknown as ToolRunContext
  return { tools, crew, exec }
}

describe('tool-crew-review', () => {
  it('crew_verdict forwards accept with a pr_url', async () => {
    const { tools, crew, exec } = harness()
    const result = await tools.get('crew_verdict')!.execute(
      { ticket_id: 't1', outcome: 'accept', rationale: 'looks good', pr_url: 'https://pr/1' }, exec(),
    )
    expect(crew.verdict).toHaveBeenCalledWith('t1', reviewer, 'accept', 'looks good', 'https://pr/1')
    expect(result).toEqual({ id: 't1', status: 'done', prUrl: 'https://pr/1' })
  })

  it('crew_verdict forwards reject without a pr_url, and rejects reject+pr_url', async () => {
    const { tools, crew, exec } = harness()
    await tools.get('crew_verdict')!.execute({ ticket_id: 't1', outcome: 'reject', rationale: 'missing tests' }, exec())
    expect(crew.verdict).toHaveBeenCalledWith('t1', reviewer, 'reject', 'missing tests', undefined)

    await expect(tools.get('crew_verdict')!.execute(
      { ticket_id: 't1', outcome: 'reject', rationale: 'x', pr_url: 'https://pr/1' }, exec(),
    )).rejects.toThrow(/pr_url is valid only with outcome accept/)
  })

  it('rejects without a calling agent', async () => {
    const { tools, exec } = harness(false)
    await expect(tools.get('crew_verdict')!.execute({ ticket_id: 't1', outcome: 'accept', rationale: 'r' }, exec()))
      .rejects.toThrow(/calling agent/)
  })

  it('presents the call and renders its output as text', () => {
    const { tools } = harness()
    expect(tools.get('crew_verdict')!.presentCall!({ ticket_id: 't1', outcome: 'accept', rationale: 'r' }))
      .toMatchObject({ kind: 'other', rawInput: 't1' })
    expect(tools.get('crew_verdict')!.output.render({}, { id: 't1' })).toEqual([{ type: 'text', text: '{"id":"t1"}' }])
  })
})
