/** One crew-board status column: title, count, and its ticket cards. */
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { CrewColumnNode } from './crew-tree.ts'
import type { WorkspaceKey } from '../locales.ts'
import { CrewTicketCard } from './CrewTicketCard.tsx'
import css from './CrewBoard.module.css'

type CrewTranslate = WorkspaceBrowserProps['t']

const COLUMN_LABEL_KEY: Record<CrewColumnNode['key'], WorkspaceKey> = {
  open: 'crew.column.open',
  assigned: 'crew.column.assigned',
  'in-progress': 'crew.column.inProgress',
  'in-review': 'crew.column.inReview',
  blocked: 'crew.column.blocked',
  done: 'crew.column.done',
}

/**
 * Render one status column.
 * @param props.column - derived column node (fixed status key + its tickets).
 * @param props.t - the browser root's locale seat.
 * @returns the column element.
 */
export function CrewColumn({ column, t }: { column: CrewColumnNode; t: CrewTranslate }) {
  return (
    <div className={css.column}>
      <div className={css.columnHeader}>
        <span>{t(COLUMN_LABEL_KEY[column.key])}</span>
        <span className={css.columnCount}>{column.tickets.length}</span>
      </div>
      <div className={css.columnBody}>
        {column.tickets.length === 0 && <div className={css.columnEmpty}>{t('crew.column.empty')}</div>}
        {column.tickets.map(ticket => (
          <CrewTicketCard key={ticket.id} ticket={ticket} t={t} />
        ))}
      </div>
    </div>
  )
}
