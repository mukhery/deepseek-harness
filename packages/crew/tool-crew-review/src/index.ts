/**
 * Model-facing `crew_verdict` tool: the sole path that can close a crew
 * ticket. Mounted globally like the other crew tool packages; only a hired
 * `reviewer`'s `toolFilter` (set at `crew_hire` time) actually exposes it.
 * @module @deepseek-ai/dsh-tool-crew-review
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { CrewTicketId } from '@deepseek-ai/dsh-crew'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

export const name = 'tool-crew-review'
export const inject = ['crew', 'tools']

/** Strip undefined-valued optional fields so a domain record satisfies the tool JSON output type. */
function compact(value: Record<string, unknown>): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Record<string, JsonValue>
}

/** Register the `crew_verdict` tool. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'crew_verdict',
    description: 'Independently verdict an in-review crew ticket. This is the ONLY way a ticket closes: '
      + 'accept sets it done (and, for an engineering ticket whose PR you already opened, attach that PR url so '
      + 'the ledger records it in the same call); reject returns it to the same assignee with your rationale as '
      + 'new context. The assignee\'s own report is not certification — form your own judgment from the cited evidence.',
    parameters: {
      ticket_id: { type: 'string', required: true, description: 'The in-review ticket to verdict.' },
      outcome: { type: 'string', required: true, enum: ['accept', 'reject'], description: 'accept | reject' },
      rationale: { type: 'string', required: true, description: 'Your reasoning; always recorded on the ticket.' },
      pr_url: { type: 'string', description: 'Opened pull request url; only meaningful with accept.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true } as const,
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) {
        throw new HarnessError('crew_verdict requires a calling agent', 'CREW_TOOL_AGENT_REQUIRED')
      }
      if (args.outcome === 'reject' && args.pr_url) {
        throw new HarnessError('pr_url is valid only with outcome accept', 'CREW_TOOL_INVALID_VERDICT')
      }
      const ticket = await ctx.crew.verdict(
        CrewTicketId(args.ticket_id),
        agent.id,
        args.outcome,
        args.rationale,
        args.pr_url,
      )
      return compact(ticket)
    },
    presentCall: args => ({ card: 'generic', title: 'Verdict ticket', kind: 'other', rawInput: args.ticket_id }) satisfies GenericCallView,
  }))
}
