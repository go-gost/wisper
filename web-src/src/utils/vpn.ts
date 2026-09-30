import { getEntrypoints } from '../store/entrypoint-store';
import type { Entrypoint } from '../api/types';

/**
 * Arm the Android app's VPN for a tun device and resolve once the device exists
 * — or the app declined or gave up. A no-op elsewhere (desktop, browser):
 * there is no bridge and nothing to arm, so it resolves true and the caller's
 * real error surfaces. See the note on [tunDeviceHolder] for why every path
 * that starts or creates a tun entrypoint must arm first.
 *
 * `net`/`routes`/`dns` are the device's address, routed subnets and DNS servers;
 * `mtu` is 0 for the implementation default.
 */
export function armVpn(net: string, routes: string, mtu: number, dns: string): Promise<boolean> {
  const bridge = (window as any).WisperNative;
  if (!bridge?.armVpn) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const cb = `__wisperArmVpn_${Date.now()}`;
    const done = (ok: boolean) => {
      delete (window as any)[cb];
      resolve(ok);
    };
    (window as any)[cb] = done;
    try {
      bridge.armVpn(net, routes, mtu, dns, cb);
    } catch (e) {
      console.warn('armVpn failed', e);
      done(true); // no bridge to wait for: let the caller report the real error
    }
  });
}

/**
 * The running tun entrypoint other than `exceptId` that holds the app's single
 * VPN device, if any. There is one device, so a second tun entrypoint cannot
 * work — and arming the VPN for it would take the device away from the
 * entrypoint that is using it. Its name goes in the "device busy" message.
 */
export function tunDeviceHolder(exceptId: string): Entrypoint | undefined {
  return getEntrypoints().find(
    (ep) => ep.type === 'tun' && ep.status === 'running' && ep.id !== exceptId,
  );
}
