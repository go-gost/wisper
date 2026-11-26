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

  return { key: host?.address || dst.address, name: address, port };
}

interface IPAddress {
  bits: 32 | 128;
  value: bigint;
}

function parseIPv4(value: string): bigint | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;

  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith('0'))) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = (result << 8n) | BigInt(octet);
  }
  return result;
}

function parseIPv6(value: string): bigint | null {
  if (value.includes('%')) return null;

  let address = value;
  const lastColon = value.lastIndexOf(':');
  const lastPart = value.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const ipv4 = parseIPv4(lastPart);
    if (ipv4 === null) return null;
    address = `${value.slice(0, lastColon + 1)}${(ipv4 >> 16n).toString(16)}:${(ipv4 & 0xffffn).toString(16)}`;
  }

  const compressedAt = address.indexOf('::');
  if (compressedAt >= 0 && address.indexOf('::', compressedAt + 2) >= 0) return null;

  let groups: string[];
  if (compressedAt >= 0) {
    const left = address.slice(0, compressedAt);
    const right = address.slice(compressedAt + 2);
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - leftGroups.length - rightGroups.length;
    if (missing < 1) return null;
    groups = [...leftGroups, ...Array<string>(missing).fill('0'), ...rightGroups];
  } else {
    groups = address.split(':');
  }
  if (groups.length !== 8) return null;

  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    result = (result << 16n) | BigInt(`0x${group}`);
  }
  return result;
}

function parseIP(value: string): IPAddress | null {
  const address = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  if (address.includes(':')) {
    const parsed = parseIPv6(address);
    return parsed === null ? null : { bits: 128, value: parsed };
  }
  const parsed = parseIPv4(address);
  return parsed === null ? null : { bits: 32, value: parsed };
}

function cidrCovers(rule: string, key: string): boolean {
  const slash = rule.lastIndexOf('/');
  if (slash <= 0 || !/^\d+$/.test(rule.slice(slash + 1))) return false;

  const prefix = Number(rule.slice(slash + 1));
  const network = parseIP(rule.slice(0, slash));
  const address = parseIP(key);
  if (!network || !address || network.bits !== address.bits || prefix > network.bits) return false;

  const hostBits = BigInt(network.bits - prefix);
  return network.value >> hostBits === address.value >> hostBits;
}

/** Whether a rule matches a bare destination address by exact, suffix, or CIDR coverage. */
export function ruleCovers(rule: string, key: string): boolean {
  const value = rule.trim();
  const normalizedRule = (value.includes('/') ? value : splitEndpoint(value).address).toLowerCase();
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedRule || !normalizedKey) return false;
  if (normalizedRule === normalizedKey) return true;
  if (normalizedRule.startsWith('.') &&
      (normalizedKey === normalizedRule.slice(1) || normalizedKey.endsWith(normalizedRule))) return true;
  return cidrCovers(normalizedRule, normalizedKey);
}

export function requestDestinationLabel(request: Pick<EntrypointRequest, 'host' | 'dst'>): string {
  const destination = requestDestination(request);
  return `${destination.name}${destination.port ? `:${destination.port}` : ''}`;
}
