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
  /** Icon name (utils/icons.ts). */
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
    icon: 'zap-off',
    tone: 'warn',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyFailed',
  },
  derp: { icon: 'hub', tone: 'muted', labelKey: 'p2pTransportRelay' },
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
    icon: 'cloud-off',
    tone: 'warn',
    labelKey: 'p2pTransportRelay',
    whyKey: 'p2pTransportWhyStun',
  },
};

export interface TransportStyle {
  icon: string;
  tone: 'direct' | 'warn' | 'muted';
  label: string;
  why: string;
  /** The badge text: the state, plus why it is on the relay. */
  text: string;
  /** The tooltip. */
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
    why,
    text: why ? `${label} · ${why}` : label,
    hint: why ? `${label} · ${why}` : t('p2pTransportHint'),
  };
}

/** TransportView is what a list row draws: computed where the locale is known
 *  (a page), so a card stays a dumb renderer. */
export interface TransportView {
  icon: string;
  tone: 'direct' | 'warn' | 'muted';
  text: string;
  hint: string;
}

/** transportView is the row-sized view of a summary: the state, a direct count
 *  when only some peers are direct, and the tooltip. */
export function transportView(summary: TransportSummary): TransportView | null {
  const st = transportStyle(summary.state);
  if (!st) return null;

  const partial = summary.state === 'direct' && summary.direct < summary.total;
  const text = partial ? `${st.label} ${summary.direct}/${summary.total}` : st.label;
  return { icon: st.icon, tone: st.tone, text, hint: st.hint };
}

export interface TransportSummary {
  /** The state worth showing for the whole object. */
  state: string;
  /** Direct peers, and how many peers reported anything. */
  direct: number;
  total: number;
}

/** What to say about an object with several peers: the most interesting state
 *  wins (a direct path beats a punch in flight beats a reason), because that is
 *  the one thing a list row has room for. */
const PRECEDENCE: PeerTransport[] = [
  'direct',
  'punching',
  'failed',
  'stun-unreachable',
  'no-candidates',
  'disabled',
  'derp',
];

export function summarizeTransports(values: (string | undefined)[]): TransportSummary {
  const present = values.filter((v): v is string => !!v);
  if (present.length === 0) return { state: '', direct: 0, total: 0 };

  const direct = present.filter(v => v === 'direct').length;
  for (const state of PRECEDENCE) {
    if (present.includes(state)) return { state, direct, total: present.length };
  }
  return { state: present[0], direct, total: present.length };
}
