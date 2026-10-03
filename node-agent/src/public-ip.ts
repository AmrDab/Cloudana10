/**
 * Public IPv4 lookup for `--public-host auto` (trimmed from provider-node-server/src/ip-detection.ts).
 * Asks a few echo services in parallel; first valid answer wins. null if none answer within 3 s.
 */
const SERVICES = ["https://api.ipify.org", "https://icanhazip.com", "https://ifconfig.me/ip"];
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

async function ask(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const ip = (await res.text()).trim();
    return res.ok && IPV4.test(ip) ? ip : null;
  } catch {
    return null;
  }
}

export async function detectPublicIp(): Promise<string | null> {
  const results = await Promise.all(SERVICES.map(ask));
  return results.find((ip) => ip !== null) ?? null;
}
