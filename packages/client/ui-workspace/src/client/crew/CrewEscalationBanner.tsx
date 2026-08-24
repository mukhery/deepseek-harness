/**
 * The "you need to act" surface: a full-width amber banner (`StateDot`'s
 * `warning` semantic — the same signal Rows.tsx already uses for "Waiting for
 * answer", not a new one), showing every blocked ticket's title and a
 * `blockedReason` excerpt. The CTA jumps directly to the matching Director
 * session when the escalation heuristic (see `crew-tree.ts`) found one;
 * otherwise it reads generically, since the human may need to open a new
 * Director thread instead.
 */
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from '../contract/slots.ts'
import type { CrewEscalationBannerState } from './crew-tree.ts'
import css from './CrewBoard.module.css'

type CrewTranslate = WorkspaceBrowserProps['t']

/**
 * Render the escalation banner.
 * @param props.banner - derived banner state (at least one blocked ticket).
 * @param props.onOpenSession - open a real session (the matched Director session, when found).
 * @param props.t - the browser root's locale seat.
 * @returns the banner element.
 */
export function CrewEscalationBanner({ banner, onOpenSession, t }: {
  banner: CrewEscalationBannerState
  onOpenSession: (sessionId: SessionId) => void
  t: CrewTranslate
}) {
  const matchedSessionId = banner.matchedSessionId
  return (
    <div className={css.banner} role="status">
      <StateDot state="warning" />
      <div className={css.bannerBody}>
        <div className={css.bannerTitle}>
          {banner.blockedTickets.length === 1
            ? t('crew.banner.oneBlocked')
            : t('crew.banner.manyBlocked', { n: banner.blockedTickets.length })}
        </div>
        <ul className={css.bannerList}>
          {banner.blockedTickets.map(ticket => (
            <li key={ticket.id}>
              <span className={css.bannerTicketTitle}>{ticket.title}</span>
              {ticket.blockedReason !== undefined && (
                <span className={css.bannerReason}>{ticket.blockedReason}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {matchedSessionId === undefined ? (
        <span className={css.bannerHint}>{t('crew.banner.noMatch')}</span>
      ) : (
        <button
          type="button"
          className={css.bannerCta}
          onClick={() => { onOpenSession(matchedSessionId) }}
        >
          {t('crew.banner.goToSession')}
        </button>
      )}
    </div>
  )
}
