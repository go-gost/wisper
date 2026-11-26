import type { EntrypointRequest } from '../api/types';

export interface RequestDestination {
  key: string;
  name: string;
  port: string;
}

/** Split a destination into the compact host/address and port the list shows. */
export function requestDestination(request: Pick<EntrypointRequest, 'host' | 'dst'>): RequestDestination {
  const dst = request.dst.trim();
  let address = dst;
  let port = '';

  if (dst.startsWith('[')) {
    const end = dst.indexOf(']');
    if (end > 0) {
      address = dst.slice(1, end);
      const suffix = dst.slice(end + 1);
      if (/^:\d+$/.test(suffix)) port = suffix.slice(1);
    }
  } else {
    const match = dst.match(/^(.*):(\d+)$/);
    if (match && !match[1].includes(':')) {
      address = match[1];
      port = match[2];
    }
  }

  const host = request.host.trim();
  return { key: host || address, name: host || address, port };
}

export function requestDestinationLabel(request: Pick<EntrypointRequest, 'host' | 'dst'>): string {
  const destination = requestDestination(request);
  return `${destination.name}${destination.port ? `:${destination.port}` : ''}`;
}
