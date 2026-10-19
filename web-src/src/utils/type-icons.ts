import type { EntrypointType, TunnelType } from '../api/types';

/** The icon glyph for each service type — the one glyph a tunnel and an
 *  entrypoint of the same type share. It is the type picker's own glyph, so
 *  the picker, a detail page's header and a list row all draw a type the same
 *  way; one table keeps them from drifting apart. */
const TYPE_ICONS: Record<TunnelType | EntrypointType, string> = {
  file: 'folder',
  http: 'globe',
  tcp: 'link',
  udp: 'broadcast',
  p2p: 'hub',
  tun: 'network',
};

/** typeIcon returns the glyph name for a service type. */
export function typeIcon(type: TunnelType | EntrypointType): string {
  return TYPE_ICONS[type];
}
