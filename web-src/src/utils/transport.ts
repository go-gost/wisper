import { t } from '../i18n/i18n';

/**
 * A p2p peer's current path, as the API reports it: either a hole-punched
 * session or, when there is none, the most specific reason. Most strings are
 * p2p's wire values (keep them in sync with p2p's status.go); `connecting` and
 * `server-unreachable` are the API's, because only it knows whether the host's
 * relay is up.
 */
export type PeerTransport =
  | 'direct'
  | 'punching'
  | 'failed'
  | 'derp'
  | 'disabled'
  | 'peer-direct-off'
  | 'no-candidates'
  | 'stun-unreachable'
  | 'server-unreachable'
  // The API's own words, not p2p's: a listed peer with no live path is still
  // connecting while the relay is up, and server-unreachable only when the
  // relay itself is down. p2p cannot report either — it has no idea whether
  // its own relay connection is the reason.
  | 'connecting';

/** The i18n keys are resolved per call: labels must follow the locale. */
interface TransportSpec {
  /** Icon name (utils/icons.ts). One icon per side: the bolt for a direct
   *  path, the hub for every relay state — the reason a peer is on the relay
   *  is the tooltip's job, not a second icon's. */
  icon: string;
  /** Style hook: a direct path, a fixable problem, plain relay, or relay
   *  because the peer itself turned the direct path off. */
  tone: 'direct' | 'warn' | 'muted' | 'info';
  labelKey: string;
  /** Why it is on the relay — empty for a direct path. */
  whyKey?: string;
  /** The detail's lead word: what the connection is, before the reason. Absent
   *  means "connected" — the badge and the RTT beside it describe a live
   *  session, so a state that has one can say so. The two states with no
   *  session (a peer still connecting, a relay that is down) name themselves
   *  instead: leading them with "Connected" contradicts the badge that was
   *  tapped to open the detail. */
  leadKey?: string;
}

const SPECS: Record<PeerTransport, TransportSpec> = {
  direct: { icon: 'zap', tone: 'direct', labelKey: 'p2pTransportDirect' },
  punching: {
    icon: 'rotate-cw',
    tone: 'warn',
    labelKey: 'p2pTransportPunching',
    whyKey: 'p2pTransportWhyPunching',
  },
  failed: {
    icon: 'hub',
    tone: 'warn',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyFailed',
  },
  derp: {
    icon: 'hub',
    tone: 'muted',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyRelay',
  },
  disabled: {
    icon: 'hub',
    tone: 'muted',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyDisabled',
  },
  'peer-direct-off': {
    icon: 'hub',
    tone: 'info',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyPeerDirectOff',
  },
  'no-candidates': {
    icon: 'hub',
    tone: 'muted',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyNoCandidates',
  },
  'stun-unreachable': {
    icon: 'hub',
    tone: 'warn',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyStun',
  },
  connecting: {
    icon: 'rotate-cw',
    tone: 'muted',
    labelKey: 'p2pTransportConnecting',
    whyKey: 'p2pTransportWhyConnecting',
    leadKey: 'p2pTransportConnecting',
  },
  'server-unreachable': {
    icon: 'close',
    tone: 'warn',
    labelKey: 'p2pTransportUnreachable',
    whyKey: 'p2pTransportWhyServerUnreachable',
    leadKey: 'p2pTransportUnreachable',
  },
};

export interface TransportStyle {
  icon: string;
  tone: 'direct' | 'warn' | 'muted' | 'info';
  /** The badge text: one word per state, the same for every peer — the reason
   *  is what the tooltip is for. */
  label: string;
  /** The tooltip: the state, and why it is on the relay. */
  hint: string;
  /** Why this peer is not on a direct path — empty when it is one. Shown as a
   *  tappable detail, because a phone has no hover for the tooltip. */
  why: string;
  /** The detail's lead word: "Connected" for a live session, or the state's own
   *  name when there is no session to connect to (see TransportSpec.leadKey). */
  lead: string;
}

/** transportStyle maps a transport value to what to draw; null when unknown
 *  (an older p2p, or no session at all — both render nothing). */
export function transportStyle(value?: string): TransportStyle | null {
  if (!value) return null;
  const spec = SPECS[value as PeerTransport];
  if (!spec) return null;
  const label = t(spec.labelKey);
  const why = spec.whyKey ? t(spec.whyKey) : '';
  return {
    icon: spec.icon,
    tone: spec.tone,
    label,
    hint: why ? `${label} · ${why}` : t('p2pTransportHint'),
    why,
    lead: t(spec.leadKey ?? 'p2pTransportConnected'),
  };
}

/** TransportView is what a list row draws — an icon, its tone and its tooltip.
 *  It is resolved where the locale is known (a page), so a card stays a dumb
 *  renderer. */
export interface TransportView {
  icon: string;
  tone: 'direct' | 'warn' | 'muted' | 'info';
  hint: string;
}

/** transportView is the row-sized view of one value. */
export function transportView(value?: string): TransportView | null {
  const st = transportStyle(value);
  return st ? { icon: st.icon, tone: st.tone, hint: st.hint } : null;
}
