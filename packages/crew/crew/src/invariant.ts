/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-crew`.
 * @module @deepseek-ai/dsh-crew/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import type { CrewTicketRecord } from '@deepseek-ai/dsh-crew'

const PACKAGE_NAME = '@deepseek-ai/dsh-crew'

/** Cordis companion plugin name. */
export const name = 'crew-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Owned relationship: a ticket's `assigneeSessionId`, whenever present, names
 * a roster member hired into the same workspace. `ctx.crew.assignTicket` and
 * `reassignTicket` both check this before writing, so a landed `tickets` put
 * failing it proves a direct domain write bypassed the runtime rather than a
 * reachable state through its own API.
 */
const install: InvariantInstaller = Object.assign(
  (ctx: Context, fail: (message: string) => never) => {
    ctx.on('domain/changed', (change: DomainChanged) => {
      if (change.domain !== 'crew' || change.table !== 'tickets' || change.operation !== 'put') return
      const ticket = change.value as CrewTicketRecord
      if (ticket.assigneeSessionId === undefined) return
      const known = ctx.crew.roster(ticket.workspaceId)
        .some(member => member.memberSessionId === ticket.assigneeSessionId)
      if (!known) {
        fail(
          `ticket '${ticket.id}' names assignee '${ticket.assigneeSessionId}' `
          + `who is not on workspace '${ticket.workspaceId}''s roster — some write path bypassed ctx.crew`,
        )
      }
    })
  },
  { inject: ['crew'] },
)

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
