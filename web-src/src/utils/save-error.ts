import { t } from '../i18n/i18n';

/**
 * saveErrorText renders a failed save for the user: the "Failed to save"
 * channel the app already has, with the backend's reason when it sent one.
 *
 * A peer key belongs to exactly one tunnel — the process-wide p2p host routes
 * it to one — so the one refusal a user hits while moving a spoke key from
 * here to a hub (or back) arrives as a raw runtime message naming a mechanism
 * they never chose. That case is translated into the reason; anything else is
 * passed through untouched, because a message the backend composed is already
 * more specific than any wording here.
 */
export function saveErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : '';
  if (msg.includes('is already used by another p2p tunnel')) {
    return `${t('saveFailed')}: ${t('peerKeyInUseHint')}`;
  }
  return `${t('saveFailed')}${msg ? ': ' + msg : ''}`;
}
