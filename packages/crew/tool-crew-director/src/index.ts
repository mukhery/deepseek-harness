/**
 * Model-facing `crew_hire`, `crew_open_ticket`, `crew_assign_ticket`, and
 * `crew_board` tools over `ctx.crew` and `ctx.subagents`. Mounted globally
 * like the other crew tool packages; the `crew-director` preset is what
 * actually exposes these to a session (any Director-preset thread, standing
 * or ad hoc, gets the full set — including `crew_open_ticket`, which a hired
 * `strategist` also receives through its own `toolFilter`).
 * @module @deepseek-ai/dsh-tool-crew-director
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import type { CrewRole } from '@deepseek-ai/dsh-crew'
import { CrewMessageId, CrewTicketId } from '@deepseek-ai/dsh-crew'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-subagent'

export const name = 'tool-crew-director'
export const inject = ['crew', 'subagents', 'tools', 'workspaceRegistry']

type HireableRole = Exclude<CrewRole, 'director'>
const HIREABLE_ROLES: HireableRole[] = ['researcher', 'strategist', 'engineer', 'reviewer']

/** The crew tools fixed to each hired role — protocol constants, not deployment config. */
const CREW_TOOLS_BY_ROLE: Record<HireableRole, readonly string[]> = {
  researcher: ['crew_report', 'crew_publish', 'crew_read_pool'],
  strategist: ['crew_report', 'crew_publish', 'crew_read_pool', 'crew_open_ticket'],
  engineer: ['crew_report', 'crew_publish', 'crew_read_pool'],
  reviewer: ['crew_verdict', 'crew_read_pool'],
}

const ROLE_PERSONA: Record<HireableRole, string> = {
  researcher: 'You are the Researcher on a crew pursuing a shared project objective. Investigate what you\'re '
    + 'assigned, and publish findings to the crew pool (crew_publish, kind "finding") so other roles can build '
    + 'on them without relaying through anyone. Report each assigned ticket with crew_report.',
  strategist: 'You are the Strategist on a crew pursuing a shared project objective. Read the crew pool '
    + '(crew_read_pool) for findings, turn them into concrete proposals, and open new tickets for them '
    + '(crew_open_ticket) citing the findings that motivated each one. Report each assigned ticket with crew_report.',
  engineer: 'You are the Engineer on a crew pursuing a shared project objective. Implement what you\'re assigned '
    + 'in your own isolated worktree — `git worktree add <path> -b <branch>` through bash, there is no separate '
    + 'worktree tool — and push the branch when done. Report with crew_report (evidence should cite the branch '
    + 'name and a diff summary) when ready for review. Your report does not close the ticket or open a PR — a '
    + 'reviewer\'s independent verdict does both.',
  reviewer: 'You are the Reviewer on a crew pursuing a shared project objective. Independently verify each '
    + 'in-review ticket\'s cited evidence yourself (read the actual diff and re-run relevant checks; the '
    + 'assignee\'s own report is not certification) before calling crew_verdict. Use session_search/session_trace '
    + 'to read the assignee\'s actual session — its real turn-by-turn work, not only the prose it chose to put in '
    + 'crew_report\'s evidence field — when the evidence alone leaves you unsure. crew_verdict is the only way a '
    + 'ticket closes. For an engineering ticket you accept: open the PR yourself first (`gh pr create` through '
    + 'bash, following the repository\'s own PR conventions) and pass the resulting URL as crew_verdict\'s pr_url '
    + 'in the same call — crew_verdict records that fact, it does not push or open anything itself.',
}

/** Deployment policy: subagent provider and any extra tools per hired role, beyond the fixed crew tools. */
export interface Config {
  /** The `ctx.subagents` continuable-capable provider name used for every `crew_hire` call. */
  provider?: string
  /** Per-role deployment tool names (e.g. web/fs/shell tool names) unioned onto each role's fixed crew tools. */
  roleToolAllow?: Record<string, string[]>
}

export const Config: z<Config> = z.object({
  provider: z.string().default('spawn'),
  roleToolAllow: z.dict(z.array(z.string())).default({}),
})

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
  return { agent, workspaceId: workspace.id }
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

/** Register the Director tools. */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'crew_hire',
    description: 'Hire a new crew member into a fixed role (researcher, strategist, engineer, or reviewer). '
      + 'This only establishes the member; assign it a ticket separately with crew_assign_ticket.',
    parameters: {
      role: { type: 'string', required: true, enum: HIREABLE_ROLES, description: HIREABLE_ROLES.join(' | ') },
      label: { type: 'string', required: true, description: 'Durable display label, e.g. "Researcher — pricing".' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { agent, workspaceId } = await callerContext(ctx, exec)
      const role = args.role
      const allow = [...CREW_TOOLS_BY_ROLE[role], ...(config.roleToolAllow?.[role] ?? [])]
      const { childId } = await ctx.subagents.startContinuable({
        provider: config.provider ?? 'spawn',
        label: args.label,
        request: {
          prompt: [{ type: 'text', text: ROLE_PERSONA[role] }],
          parent: agent,
          persona: ROLE_PERSONA[role],
          toolFilter: { allow },
        },
        signal: exec.signal,
      })
      const roster = await ctx.crew.hire({ workspaceId, memberSessionId: childId, role, label: args.label })
      return compact(roster)
    },
    presentCall: args => present('Hire crew member', 'other', args.label),
  }))

  ctx.tools.register(defineTool({
    name: 'crew_open_ticket',
    description: 'Open a new crew ticket, unassigned. Assign it separately with crew_assign_ticket.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short human-facing title.' },
      objective: { type: 'string', required: true, description: 'The objective delivered to whoever is assigned.' },
      role: { type: 'string', required: true, enum: HIREABLE_ROLES, description: 'Role this ticket is scoped to.' },
      cites_message_ids: {
        type: 'array', items: { type: 'string' }, description: 'Pool message ids this ticket is motivated by.',
      },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { workspaceId } = await callerContext(ctx, exec)
      const ticket = await ctx.crew.openTicket({
        workspaceId,
        title: args.title,
        objective: args.objective,
        role: args.role,
        ...args.cites_message_ids
          ? { citesMessageIds: args.cites_message_ids.map(id => CrewMessageId(id)) }
          : {},
      })
      return compact(ticket)
    },
    presentCall: args => present('Open crew ticket', 'other', args.title),
  }))

  ctx.tools.register(defineTool({
    name: 'crew_assign_ticket',
    description: 'Assign an open ticket to a roster member hired into the ticket\'s role, and deliver the '
      + 'ticket\'s objective as that member\'s next turn.',
    parameters: {
      ticket_id: { type: 'string', required: true, description: 'Ticket to assign.' },
      member_session_id: { type: 'string', required: true, description: 'Roster member to assign it to.' },
    },
    output: JSON_OUTPUT,
    async execute(args, exec) {
      const { agent } = await callerContext(ctx, exec)
      const ticketId = CrewTicketId(args.ticket_id)
      const memberSessionId = SessionId(args.member_session_id)
      const ticket = await ctx.crew.assignTicket(ticketId, memberSessionId)
      await ctx.subagents.followup(agent, memberSessionId, [{ type: 'text', text: ticket.objective }], {
        source: { kind: 'coordinator', form: 'relay', senderSessionId: agent.id },
        signal: exec.signal,
      })
      return compact(ticket)
    },
    presentCall: args => present('Assign crew ticket', 'other', args.ticket_id),
  }))

  ctx.tools.register(defineTool({
    name: 'crew_board',
    description: 'Read the crew\'s current roster and full ticket board for this workspace.',
    parameters: {},
    output: JSON_OUTPUT,
    async execute(_args, exec) {
      const { workspaceId } = await callerContext(ctx, exec)
      return {
        roster: ctx.crew.roster(workspaceId).map(compact),
        tickets: ctx.crew.tickets(workspaceId).map(compact),
      }
    },
    presentCall: () => present('Read crew board', 'read'),
  }))
}
