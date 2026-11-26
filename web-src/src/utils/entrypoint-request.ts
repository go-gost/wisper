import type { EntrypointRequest } from '../api/types';

export interface RequestDestination {
  key: string;
  name: string;
  port: string;
}

interface EndpointParts {
  address: string;
  port: string;
  ipv6: boolean;
}

function splitEndpoint(value: string): EndpointParts {
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) {
      const suffix = value.slice(end + 1);
      return {
        address: value.slice(1, end),
        port: /^:\d+$/.test(suffix) ? suffix.slice(1) : '',
        ipv6: true,
      };
    }
  }

  const separator = value.indexOf(':');
  if (separator > 0 && separator === value.lastIndexOf(':')) {
    const port = value.slice(separator + 1);
    if (/^\d+$/.test(port)) {
      return { address: value.slice(0, separator), port, ipv6: false };
    }
  }

  return { address: value, port: '', ipv6: value.includes(':') };
}

/** Split a destination into the compact host/address and port the list shows. */
export function requestDestination(request: Pick<EntrypointRequest, 'host' | 'dst'>): RequestDestination {
  const dst = splitEndpoint(request.dst.trim());
  const hostValue = request.host.trim();
  const host = hostValue ? splitEndpoint(hostValue) : null;
  const endpoint = host ?? dst;
  const address = endpoint.ipv6 ? `[${endpoint.address}]` : endpoint.address;
  const port = host?.port || dst.port;

  return { key: hostValue || dst.address, name: address, port };
}

export function requestDestinationLabel(request: Pick<EntrypointRequest, 'host' | 'dst'>): string {
  const destination = requestDestination(request);
  return `${destination.name}${destination.port ? `:${destination.port}` : ''}`;
}
