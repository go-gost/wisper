import { t } from '../i18n/i18n';

/**
 * A p2p peer's current path, as p2p's Status.PeerTransports reports it: either
 * a hole-punched session or, when there is none, the most specific reason. The
 * strings are p2p's wire values — keep them in sync with p2p's status.go.
 */
export type PeerTransport =
  | 'direct'
  | 'punching'
  | 'failed'
  | 'derp'
  | 'disabled'
  | 'no-candidates'
  | 'stun-unreachable';

/** The i18n keys are resolved per call: labels must follow the locale. */
interface TransportSpec {
  /** Icon name (utils/icons.ts). One icon per side: the bolt for a direct
   *  path, the hub for every relay state — the reason a peer is on the relay
   *  is the tooltip's job, not a second icon's. */
  icon: string;
  /** Style hook: a direct path, a fixable problem, or plain relay. */
  tone: 'direct' | 'warn' | 'muted';
  labelKey: string;
  /** Why it is on the relay — empty for a direct path. */
  whyKey?: string;
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
};

export interface TransportStyle {
  icon: string;
  tone: 'direct' | 'warn' | 'muted';
  /** The badge text: one word per state, the same for every peer — the reason
   *  is what the tooltip is for. */
  label: string;
  /** The tooltip: the state, and why it is on the relay. */
  hint: string;
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
  };
}

/** TransportView is what a list row draws — an icon, its tone and its tooltip.
 *  It is resolved where the locale is known (a page), so a card stays a dumb
 *  renderer. */
export interface TransportView {
  icon: string;
  tone: 'direct' | 'warn' | 'muted';
  hint: string;
}

/** transportView is the row-sized view of one value. */
export function transportView(value?: string): TransportView | null {
  const st = transportStyle(value);
  return st ? { icon: st.icon, tone: st.tone, hint: st.hint } : null;
}
