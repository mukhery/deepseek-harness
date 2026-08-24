/**
 * One crew ticket card (Figma-free, matches Rows.tsx's plain presentational
 * convention): title/objective/role badge/assignee label always visible;
 * status-conditional fields shown prominently rather than buried behind a
 * disclosure — evidence+summary for `in-review`, `blockedReason` for
 * `blocked`, `verdictRationale`+`prUrl` for `done`.
 */
import clsx from 'clsx'
import type { CrewRole } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { CrewTicketNode } from './crew-tree.ts'
import type { WorkspaceKey } from '../locales.ts'
import css from './CrewBoard.module.css'

/** The standard locale seat, prop-passed from the browser root (see Rows.tsx's `RowTranslate`). */
type CrewTranslate = WorkspaceBrowserProps['t']

const ROLE_LABEL_KEY: Record<CrewRole, WorkspaceKey> = {
  director: 'crew.role.director',
  researcher: 'crew.role.researcher',
  strategist: 'crew.role.strategist',
  engineer: 'crew.role.engineer',
  reviewer: 'crew.role.reviewer',
}

/**
 * Render one crew ticket card.
 * @param props.ticket - derived ticket node (see {@link CrewTicketNode}).
 * @param props.t - the browser root's locale seat.
 * @returns the card element.
 */
export function CrewTicketCard({ ticket, t }: { ticket: CrewTicketNode; t: CrewTranslate }) {
  return (
    <div className={css.card}>
      <div className={css.cardHeader}>
        <span className={css.cardTitle}>{ticket.title}</span>
        <span className={css.roleBadge}>{t(ROLE_LABEL_KEY[ticket.role])}</span>
      </div>
      <div className={css.cardObjective}>{ticket.objective}</div>
      <div className={css.cardAssignee}>
        {ticket.assigneeLabel === undefined
          ? t('crew.card.unassigned')
          : t('crew.card.assignee', { name: ticket.assigneeLabel })}
      </div>
      {ticket.status === 'in-review' && (
        <div className={css.cardDetail}>
          {ticket.evidence !== undefined && (
            <div>{t('crew.card.evidence')} {ticket.evidence}</div>
          )}
          {ticket.summary !== undefined && (
            <div>{t('crew.card.summary')} {ticket.summary}</div>
          )}
        </div>
      )}
      {ticket.status === 'blocked' && ticket.blockedReason !== undefined && (
        <div className={clsx(css.cardDetail, css.cardBlocked)}>{ticket.blockedReason}</div>
      )}
      {ticket.status === 'done' && (ticket.verdictRationale !== undefined || ticket.prUrl !== undefined) && (
        <div className={css.cardDetail}>
          {ticket.verdictRationale !== undefined && (
            <div>{t('crew.card.verdict')} {ticket.verdictRationale}</div>
          )}
          {ticket.prUrl !== undefined && (
            <a href={ticket.prUrl} target="_blank" rel="noreferrer">{ticket.prUrl}</a>
          )}
        </div>
      )}
    </div>
  )
}
