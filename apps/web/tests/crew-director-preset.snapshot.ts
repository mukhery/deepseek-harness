import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { assertFixtureInventory, launchWebScaffold, type WebScaffold } from './scaffold.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/crew-director', import.meta.url))
const FIXTURE = `${SNAPSHOT_DIR}/session.jsonl`
const OVERRIDE = `${SNAPSHOT_DIR}/replay.override.json`
const PROMPT = 'Open a research ticket for competitor pricing, then check the crew board.'

describe('crew-director agent preset', () => {
  let scaffold: WebScaffold
  let agentHandle: AgentHandle

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ replayFixture: FIXTURE, replayOverride: OVERRIDE })
    // ctx.crew resolves the caller's workspace from a registered Workspace
    // record, not bare cwd — nothing creates one for the scaffold's temp
    // directory automatically (a real deployment does this through the "add
    // workspace" UI flow or the startup history bootstrap).
    await scaffold.ctx.workspaceRegistry.create(scaffold.workspaceCwd)
    agentHandle = await scaffold.ctx.agents.create({
      sessionId: SessionId('crew-director-preset-smoke'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'crew-director' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => scaffold.ctx.agentPresets.mount(agentCtx, 'crew-director').then(() => undefined),
    })
  })

  afterAll(async () => {
    const failures: unknown[] = []
    await agentHandle?.dispose().catch((error: unknown) => failures.push(error))
    await scaffold?.close().catch((error: unknown) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) throw new AggregateError(failures, 'crew-director preset smoke teardown failed')
  })

  it('opens a ticket, then reads it back off the crew board, in one workspace', async () => {
    agentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: PROMPT }],
      source: { kind: 'user' },
    }))
    await agentHandle.agent.whenIdle()

    const toolResultBlocks = new Map(agentHandle.agent.session.events
      .filter(event => event.type === 'tool/result')
      .map(event => event.data.message.content[0])
      .map(block => [block.toolCallId, block] as const))

    const text = (block: { content: readonly { type: string; text?: string }[] } | undefined): string => {
      if (block === undefined) throw new Error('expected tool-result block is missing')
      return block.content.filter(part => part.type === 'text').map(part => part.text).join('')
    }

    const ticket = JSON.parse(text(toolResultBlocks.get(CallId('call_crew_open_ticket')))) as {
      id: string
      title: string
      status: string
      role: string
    }
    expect(ticket).toMatchObject({ title: 'Competitor pricing', status: 'open', role: 'researcher' })

    const board = JSON.parse(text(toolResultBlocks.get(CallId('call_crew_board')))) as {
      roster: unknown[]
      tickets: { id: string; title: string }[]
    }
    expect(board.roster).toEqual([])
    expect(board.tickets).toEqual([expect.objectContaining({ id: ticket.id, title: 'Competitor pricing' })])

    const finalMessage = agentHandle.agent.session.events.findLast(event => event.type === 'assistant/message')
    if (finalMessage?.type !== 'assistant/message') throw new Error('expected a final assistant/message event')
    expect(finalMessage.data.message.content
      .filter(block => block.type === 'text').map(block => block.text).join('')).toBe('CREW READY')

    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'replay.override.json'])
  })
})
