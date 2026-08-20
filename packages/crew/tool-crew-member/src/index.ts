/**
 * Model-facing `crew_report`, `crew_publish`, and `crew_read_pool` tools over
 * `ctx.crew`. Mounted as an ordinary deployment-level plugin: a hired crew
 * member's `toolFilter` (set at `crew_hire` time) decides which of these are
 * actually visible to it, not a separate preset composition.
 * @module @deepseek-ai/dsh-tool-crew-member
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { CrewMessageKind } from '@deepseek-ai/dsh-crew'
import { CrewTicketId } from '@deepseek-ai/dsh-crew'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'

export const name = 'tool-crew-member'
export const inject = ['crew', 'tools', 'workspaceRegistry']

const MESSAGE_KINDS: CrewMessageKind[] = ['finding', 'decision', 'handoff', 'blocker']

/** Resolve the calling agent and the workspace its session's cwd belongs to. */
async function callerContext(ctx: Context, exec: ToolRunContext) {
  const agent = exec.agent
  if (agent === undefined) {
    throw new HarnessError('crew tools require a calling agent', 'CREW_TOOL_AGENT_REQUIRED')
  }
  const cwd = agent.session.header.cwd
  if (cwd === undefined) {
    throw new HarnessError('crew tools require a session with a working directory', 'CREW_TOOL_NO_WORKSPACE')
  }
  const workspace = await ctx.workspaceRegistry.resolveByPath(cwd)
  if (workspace === undefined) {
    throw new HarnessError(`no workspace is registered for '${cwd}'`, 'CREW_TOOL_NO_WORKSPACE')
  }
  return { sessionId: agent.id, workspaceId: workspace.id }
}

function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Strip undefined-valued optional fields so a domain record satisfies the tool JSON output type. */
function compact(value: Record<string, unknown>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Record<string, JsonValue>
}

const JSON_OUTPUT = {
  schema: { type: 'object', additionalProperties: true } as const,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/** Register the crew member tools. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'crew_report',
    description: 'Report on your currently assigned crew ticket. "ready_for_review" submits evidence and a '
      + 'summary for independent review — it does NOT close the ticket; only a reviewer\'s verdict does. '
      + '"blocked" pauses the ticket pending resolution (typically a human decision).',
    parameters: {
      ticket_id: { type: 'string', required: true, description: 'The ticket id you are reporting on.' },
      outcome: {
        type: 'string', required: true, enum: ['ready_for_review', 'blocked'],
        description: 'ready_for_review | blocked',
      },
      evidence: { type: 'string', description: 'Cited evidence; required with ready_for_review.' },
      summary: { type: 'string', description: 'Short closing summary; required with ready_for_review.' },
      reason: { type: 'string', description: 'Why the ticket cannot proceed; required with blocked.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { sessionId } = await callerContext(ctx, exec)
      const ticketId = CrewTicketId(args.ticket_id)
      if (args.outcome === 'ready_for_review') {
        if (!args.evidence || !args.summary) {
          throw new HarnessError('evidence and summary are required with outcome ready_for_review', 'CREW_TOOL_INVALID_REPORT')
        }
        const ticket = await ctx.crew.submitForReview(ticketId, sessionId, args.evidence, args.summary)
        return compact(ticket)
      }
      if (!args.reason) {
        throw new HarnessError('reason is required with outcome blocked', 'CREW_TOOL_INVALID_REPORT')
      }
      const ticket = await ctx.crew.submitBlocked(ticketId, sessionId, args.reason)
      return compact(ticket)
    },
    presentCall: args => present('Report on ticket', 'other', args.ticket_id),
  }))

  ctx.tools.register(defineTool({
    name: 'crew_publish',
    description: 'Publish one structured message to the crew\'s shared message pool, so other crew members can '
      + 'find it without it being relayed through a coordinator. Use "finding" for research results, "decision" '
      + 'for a strategy call, "handoff" for cross-role context, and "blocker" for a shared obstacle.',
    parameters: {
      topic: { type: 'string', required: true, description: 'Short topic string other members can filter by.' },
      kind: { type: 'string', required: true, enum: MESSAGE_KINDS, description: MESSAGE_KINDS.join(' | ') },
      body: { type: 'string', required: true, description: 'The message content.' },
      cites_ticket_id: { type: 'string', description: 'Ticket this message relates to, if any.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { sessionId, workspaceId } = await callerContext(ctx, exec)
      const message = await ctx.crew.publish({
        workspaceId,
        topic: args.topic,
        kind: args.kind,
        from: sessionId,
        body: args.body,
        ...args.cites_ticket_id ? { citesTicketId: CrewTicketId(args.cites_ticket_id) } : {},
      })
      return compact(message)
    },
    presentCall: args => present('Publish to crew pool', 'other', args.topic),
  }))

  ctx.tools.register(defineTool({
    name: 'crew_read_pool',
    description: 'Read the crew\'s shared message pool, oldest first. Optionally filter by exact-match topics '
      + 'and by a lower-bound publish time.',
    parameters: {
      topics: { type: 'array', items: { type: 'string' }, description: 'Exact-match topic allowlist.' },
      since: { type: 'string', description: 'ISO-8601 instant; only messages at or after it are returned.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { workspaceId } = await callerContext(ctx, exec)
      const messages = ctx.crew.readPool({
        workspaceId,
        ...args.topics ? { topics: args.topics } : {},
        ...args.since ? { since: args.since } : {},
      })
      return { messages: messages.map(compact) }
    },
    presentCall: () => present('Read crew pool', 'read'),
  }))
}
