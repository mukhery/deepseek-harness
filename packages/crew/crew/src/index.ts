/**
 * Workspace-scoped crew roster, ticket ledger, and message pool
 * (`ctx.crew`). One process-wide `crew` domain serves every workspace; every
 * record is self-scoped by an explicit `workspaceId` field, so any number of
 * Director-preset sessions in one workspace share and safely mutate the same
 * roster/ticket/pool state through the domain's single per-domain write
 * chain (`KvTable.update` already serializes concurrent callers — no
 * additional compare-and-set field is needed on top of it).
 * @module @deepseek-ai/dsh-crew
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { crewDomainSpec } from './spec.ts'
import type { CrewMessageRecord, CrewRosterRecord, CrewTicketRecord } from './spec.ts'
import type {
  CrewMessageId as CrewMessageIdBrand,
  CrewMessageKind,
  CrewRole,
  CrewTicketId as CrewTicketIdBrand,
} from './types.ts'

export type { CrewRole, CrewTicketStatus, CrewMessageKind } from './types.ts'
export { crewDomainSpec, crewRosterRecord, crewTicketRecord, crewMessageRecord } from './spec.ts'
export type { CrewRosterRecord, CrewTicketRecord, CrewMessageRecord } from './spec.ts'

/** Identifies one durable ticket record (see `src/types.ts` for the brand rationale). */
export type CrewTicketId = CrewTicketIdBrand

/** Identifies one durable message-pool record (see `src/types.ts` for the brand rationale). */
export type CrewMessageId = CrewMessageIdBrand

/**
 * Brand a string as a {@link CrewTicketId}.
 * @param id - Raw ticket id string.
 * @returns the same string, branded at compile time.
 */
export function CrewTicketId(id: string): CrewTicketId {
  return id as CrewTicketId
}

/**
 * Brand a string as a {@link CrewMessageId}.
 * @param id - Raw message id string.
 * @returns the same string, branded at compile time.
 */
export function CrewMessageId(id: string): CrewMessageId {
  return id as CrewMessageId
}

/** A ticket/roster operation named an id this workspace's crew domain does not hold. */
export class CrewUnknownError extends Error {
  /**
   * @param message - Which id was unknown and in what workspace.
   */
  constructor(message: string) {
    super(message)
    this.name = 'CrewUnknownError'
  }
}

/** A ticket mutation was attempted from a status that does not permit it. */
export class CrewTransitionError extends Error {
  /**
   * @param message - The rejected transition and the ticket's actual status.
   */
  constructor(message: string) {
    super(message)
    this.name = 'CrewTransitionError'
  }
}

/** A caller attempted a ticket mutation reserved for a different session (the recorded assignee or a reviewer). */
export class CrewAuthorityError extends Error {
  /**
   * @param message - Which mutation was rejected and why the caller lacks authority.
   */
  constructor(message: string) {
    super(message)
    this.name = 'CrewAuthorityError'
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    crew: CrewRuntime
  }
}

/** Input to {@link CrewRuntime.hire}. */
export interface CrewHireInput {
  readonly workspaceId: WorkspaceId
  readonly memberSessionId: SessionId
  readonly role: CrewRole
  readonly label: string
}

/** Input to {@link CrewRuntime.openTicket}. */
export interface CrewOpenTicketInput {
  readonly workspaceId: WorkspaceId
  readonly title: string
  readonly objective: string
  readonly role: CrewRole
  readonly citesMessageIds?: readonly CrewMessageId[]
}

/** Input to {@link CrewRuntime.publish}. */
export interface CrewPublishInput {
  readonly workspaceId: WorkspaceId
  readonly topic: string
  readonly kind: CrewMessageKind
  readonly from: SessionId
  readonly body: string
  readonly citesTicketId?: CrewTicketId
}

/** Filter for {@link CrewRuntime.readPool}. */
export interface CrewReadPoolFilter {
  readonly workspaceId: WorkspaceId
  /** Exact-match topic allowlist; omitted reads every topic. */
  readonly topics?: readonly string[]
  /** Only messages published at or after this ISO-8601 instant. */
  readonly since?: string
}

/**
 * Crew roster, ticket-ledger, and message-pool runtime. Opens the single
 * process-wide `crew` domain at startup; every method takes an explicit
 * `workspaceId` (directly, or via the ticket/roster record it loads) rather
 * than reading ambient state, matching the domain's per-record scoping.
 */
export class CrewRuntime extends Service {
  static inject = ['storageDomain']

  // Definite-assignment: Cordis publishes a Service to `ctx` only after
  // `[Service.init]` resolves, and init assigns all three in one step with
  // nothing between construction and that assignment calling a table
  // accessor — unlike `dsh-workspace`'s own guarded `requireTable()`, no
  // caller can observe these before they exist, so a runtime "not started"
  // guard here would be unreachable dead code.
  private rosterTableValue!: KvTable<SessionId, CrewRosterRecord>
  private ticketTableValue!: KvTable<CrewTicketId, CrewTicketRecord>
  private messageTableValue!: KvTable<CrewMessageId, CrewMessageRecord>

  constructor(ctx: Context) {
    super(ctx, 'crew')
  }

  /** Open the domain and resolve its three table handles. */
  protected async [Service.init](): Promise<void> {
    const domain = await this.ctx.storageDomain.open(crewDomainSpec)
    this.ctx.effect(() => () => domain.close(), 'crew.domainClose')
    this.rosterTableValue = domain.table('roster')
    this.ticketTableValue = domain.table('tickets')
    this.messageTableValue = domain.table('messages')
  }

  /**
   * Record a newly hired continuable subagent's durable role binding. The
   * caller publishes the child through `ctx.subagents.startContinuable()`
   * first; this only records the roster fact once that session id exists.
   * @param input - Workspace, hired session id, role, and durable label.
   * @returns the stored roster record.
   */
  async hire(input: CrewHireInput): Promise<CrewRosterRecord> {
    const record: CrewRosterRecord = {
      memberSessionId: input.memberSessionId,
      workspaceId: input.workspaceId,
      role: input.role,
      label: input.label,
      hiredAt: new Date().toISOString(),
    }
    await this.rosterTableValue.put(input.memberSessionId, record)
    return record
  }

  /**
   * List every roster member hired into one workspace's crew.
   * @param workspaceId - Workspace to list.
   * @returns roster records in insertion order.
   */
  roster(workspaceId: WorkspaceId): CrewRosterRecord[] {
    return [...this.rosterTableValue.entries()]
      .map(([, record]) => record)
      .filter(record => record.workspaceId === workspaceId)
  }

  /**
   * Open a new ticket in `open` status, unassigned.
   * @param input - Workspace, title, objective, and role scope.
   * @returns the stored ticket record.
   */
  async openTicket(input: CrewOpenTicketInput): Promise<CrewTicketRecord> {
    const now = new Date().toISOString()
    const record: CrewTicketRecord = {
      id: CrewTicketId(randomUUID()),
      workspaceId: input.workspaceId,
      title: input.title,
      objective: input.objective,
      role: input.role,
      status: 'open',
      citesMessageIds: input.citesMessageIds === undefined ? [] : [...input.citesMessageIds],
      createdAt: now,
      updatedAt: now,
    }
    await this.ticketTableValue.put(record.id, record)
    return record
  }

  /**
   * Assign an `open` ticket to a roster member hired into the ticket's role.
   * @param ticketId - Ticket to assign.
   * @param memberSessionId - Roster member to assign it to.
   * @returns the updated ticket record.
   */
  async assignTicket(ticketId: CrewTicketId, memberSessionId: SessionId): Promise<CrewTicketRecord> {
    const member = this.requireRosterMember(memberSessionId)
    return await this.transition(ticketId, ['open'], (ticket) => {
      this.requireAssignable(ticketId, ticket, member)
      return { ...ticket, status: 'assigned', assigneeSessionId: memberSessionId }
    })
  }

  /**
   * Mark an assigned ticket as actively being worked.
   * @param ticketId - Ticket to advance.
   * @param memberSessionId - Caller, who must be the recorded assignee.
   * @returns the updated ticket record.
   */
  async startWork(ticketId: CrewTicketId, memberSessionId: SessionId): Promise<CrewTicketRecord> {
    return await this.transition(ticketId, ['assigned'], (ticket) => {
      this.requireAssignee(ticketId, ticket, memberSessionId)
      return { ...ticket, status: 'in-progress' }
    })
  }

  /**
   * Submit a working ticket's evidence for independent review. Only the
   * recorded assignee may submit; this never sets `done` — only
   * {@link verdict}'s `accept` outcome does.
   * @param ticketId - Ticket to submit.
   * @param memberSessionId - Caller, who must be the recorded assignee.
   * @param evidence - Cited evidence (branch/diff summary, findings, etc.).
   * @param summary - Short closing summary of what was done.
   * @returns the updated ticket record.
   */
  async submitForReview(
    ticketId: CrewTicketId,
    memberSessionId: SessionId,
    evidence: string,
    summary: string,
  ): Promise<CrewTicketRecord> {
    return await this.transition(ticketId, ['assigned', 'in-progress'], (ticket) => {
      this.requireAssignee(ticketId, ticket, memberSessionId)
      return { ...ticket, status: 'in-review', evidence, summary }
    })
  }

  /**
   * Mark a working ticket blocked, pending resolution (typically a human
   * escalation) before it can be reassigned or continue.
   * @param ticketId - Ticket to block.
   * @param memberSessionId - Caller, who must be the recorded assignee.
   * @param reason - Why the ticket cannot proceed.
   * @returns the updated ticket record.
   */
  async submitBlocked(ticketId: CrewTicketId, memberSessionId: SessionId, reason: string): Promise<CrewTicketRecord> {
    return await this.transition(ticketId, ['assigned', 'in-progress'], (ticket) => {
      this.requireAssignee(ticketId, ticket, memberSessionId)
      return { ...ticket, status: 'blocked', blockedReason: reason }
    })
  }

  /**
   * Reassign a `blocked` or `open` ticket to a roster member — typically
   * called once a blocker is resolved (an escalation was answered).
   * @param ticketId - Ticket to reassign.
   * @param memberSessionId - Roster member to assign it to.
   * @returns the updated ticket record.
   */
  async reassignTicket(ticketId: CrewTicketId, memberSessionId: SessionId): Promise<CrewTicketRecord> {
    const member = this.requireRosterMember(memberSessionId)
    return await this.transition(ticketId, ['open', 'blocked'], (ticket) => {
      this.requireAssignable(ticketId, ticket, member)
      return { ...ticket, status: 'assigned', assigneeSessionId: memberSessionId, blockedReason: undefined }
    })
  }

  /**
   * Independently verdict an `in-review` ticket. This is the sole path that
   * can set `done`, and the sole path that can attach `prUrl` — a caller
   * accepting an engineering ticket after opening its PR passes `prUrl` in
   * the same call, so the ledger's `done` state and its PR fact commit
   * together. A `reject` returns the ticket directly to `assigned` for the
   * same assignee with the rationale attached as new context, rather than
   * resting in a separate terminal status.
   * @param ticketId - Ticket to verdict.
   * @param reviewerSessionId - Reviewer session recording the verdict.
   * @param outcome - `accept` closes the ticket; `reject` reopens it.
   * @param rationale - The reviewer's reasoning, always recorded.
   * @param prUrl - Opened pull request URL; only meaningful with `accept`.
   * @returns the updated ticket record.
   */
  async verdict(
    ticketId: CrewTicketId,
    reviewerSessionId: SessionId,
    outcome: 'accept' | 'reject',
    rationale: string,
    prUrl?: string,
  ): Promise<CrewTicketRecord> {
    this.requireRosterMember(reviewerSessionId)
    return await this.transition(ticketId, ['in-review'], (ticket) => {
      if (outcome === 'accept') {
        return {
          ...ticket,
          status: 'done',
          verdictRationale: rationale,
          ...(prUrl === undefined ? {} : { prUrl }),
        }
      }
      return {
        ...ticket,
        status: 'assigned',
        verdictRationale: rationale,
        evidence: undefined,
        summary: undefined,
      }
    })
  }

  /**
   * Look up one ticket, synchronously from memory.
   * @param ticketId - Ticket id.
   * @returns the ticket record, or `undefined` when unknown.
   */
  ticket(ticketId: CrewTicketId): CrewTicketRecord | undefined {
    return this.ticketTableValue.get(ticketId)
  }

  /**
   * List every ticket open in one workspace.
   * @param workspaceId - Workspace to list.
   * @returns ticket records in insertion order.
   */
  tickets(workspaceId: WorkspaceId): CrewTicketRecord[] {
    return [...this.ticketTableValue.entries()]
      .map(([, record]) => record)
      .filter(record => record.workspaceId === workspaceId)
  }

  /**
   * Publish one structured message to the workspace's pool.
   * @param input - Workspace, topic, kind, publisher, and body.
   * @returns the stored message record.
   */
  async publish(input: CrewPublishInput): Promise<CrewMessageRecord> {
    const record: CrewMessageRecord = {
      id: CrewMessageId(randomUUID()),
      workspaceId: input.workspaceId,
      topic: input.topic,
      kind: input.kind,
      from: input.from,
      body: input.body,
      ...(input.citesTicketId === undefined ? {} : { citesTicketId: input.citesTicketId }),
      createdAt: new Date().toISOString(),
    }
    await this.messageTableValue.put(record.id, record)
    return record
  }

  /**
   * Read the workspace's message pool, optionally filtered by topic and
   * publish time, oldest first.
   * @param filter - Workspace, optional topic allowlist, optional lower bound.
   * @returns matching message records in publish order.
   */
  readPool(filter: CrewReadPoolFilter): CrewMessageRecord[] {
    const topics = filter.topics === undefined ? undefined : new Set(filter.topics)
    return [...this.messageTableValue.entries()]
      .map(([, record]) => record)
      .filter(record => record.workspaceId === filter.workspaceId)
      .filter(record => topics === undefined || topics.has(record.topic))
      .filter(record => filter.since === undefined || record.createdAt >= filter.since)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  }

  private requireRosterMember(memberSessionId: SessionId): CrewRosterRecord {
    const member = this.rosterTableValue.get(memberSessionId)
    if (member === undefined) {
      throw new CrewUnknownError(`crew domain holds no roster member '${memberSessionId}'`)
    }
    return member
  }

  private requireAssignee(ticketId: CrewTicketId, ticket: CrewTicketRecord, memberSessionId: SessionId): void {
    if (ticket.assigneeSessionId !== memberSessionId) {
      throw new CrewAuthorityError(
        `cannot mutate ticket '${ticketId}': caller '${memberSessionId}' is not its recorded assignee`,
      )
    }
  }

  /** Shared (re)assignment precondition: the member belongs to the ticket's workspace and was hired into its role. */
  private requireAssignable(ticketId: CrewTicketId, ticket: CrewTicketRecord, member: CrewRosterRecord): void {
    if (member.workspaceId !== ticket.workspaceId) {
      throw new CrewAuthorityError(
        `cannot assign ticket '${ticketId}': member '${member.memberSessionId}' belongs to a different workspace`,
      )
    }
    if (member.role !== ticket.role) {
      throw new CrewAuthorityError(
        `cannot assign ticket '${ticketId}' (role '${ticket.role}') to member '${member.memberSessionId}' `
        + `hired as '${member.role}'`,
      )
    }
  }

  /**
   * Apply one ticket transition on the domain's write chain. `fn` sees the
   * value current at its queue slot (`KvTable.update` semantics), so
   * concurrent callers from different Director threads never interleave; a
   * status outside `from` or a synchronous authority throw inside `fn` both
   * abort the update, per `dsh-storage-domain`'s own-error propagation.
   */
  private async transition(
    ticketId: CrewTicketId,
    from: readonly CrewTicketRecord['status'][],
    fn: (ticket: CrewTicketRecord) => CrewTicketRecord,
  ): Promise<CrewTicketRecord> {
    const table = this.ticketTableValue
    if (table.get(ticketId) === undefined) {
      throw new CrewUnknownError(`crew domain holds no ticket '${ticketId}'`)
    }
    return await table.update(ticketId, (current) => {
      if (!from.includes(current.status)) {
        throw new CrewTransitionError(
          `cannot transition ticket '${ticketId}' from status '${current.status}' `
          + `(expected one of: ${from.join(', ')})`,
        )
      }
      return { ...fn(current), updatedAt: new Date().toISOString() }
    })
  }
}

export default CrewRuntime
