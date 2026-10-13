/**
 * The production price defaults (docs/PRICES_USD.md): dollar prices converted to µCLD at $0.10 per CLD. Other tests
 * run at a small price scale (tests/helpers/v1-db.ts); this one clears it and reads env.ts defaults.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { resetEnv } from "../src/config/env.js";
import { priceUcldPerHour, priceUsdPerHour, usdToUcld } from "../src/services/deployment-spec.js";

beforeAll(() => {
  process.env.JWT_SECRET ??= "x".repeat(40);
  for (const k of Object.keys(process.env)) if (/^PRICE_|^USD_PER_CLD$|^BASE_FEE_/.test(k)) delete process.env[k];
  resetEnv();
});

const site = { files: [{ path: "index.html", contentBase64: "" }] };
const container = (o: Record<string, unknown> = {}) => ({ image: "x", ports: [{ container: 80 }], cpu: 500, memMb: 1024, storageMb: 1024, ...o });

describe("dollar price table at $0.10 per CLD", () => {
  it("converts dollars to µCLD without float slivers", () => {
    expect(usdToUcld(0.0014)).toBe(14_000);
    expect(usdToUcld(0.3)).toBe(3_000_000);
    expect(usdToUcld(2)).toBe(20_000_000);
  });

  it("prices the documented examples", () => {
    // Static site: $0.0014/h.
    expect(priceUsdPerHour("static", site as never)).toBe(0.0014);
    expect(priceUcldPerHour("static", site as never)).toBe(14_000);
    // Small web container: 0.5 vCPU, 1 GB, 1 GB disk = $0.0063/h.
    expect(priceUsdPerHour("container", container() as never)).toBeCloseTo(0.0063, 10);
    expect(priceUcldPerHour("container", container() as never)).toBe(63_000);
    // Standard-GPU endpoint replica: 1 GPU, 4 vCPU, 16 GB, 50 GB = $0.3642/h.
    const standard = container({ cpu: 4000, memMb: 16_384, storageMb: 51_200, gpu: { count: 1, class: "standard" } });
    expect(priceUsdPerHour("container", standard as never)).toBeCloseTo(0.3642, 10);
    expect(priceUcldPerHour("container", standard as never)).toBe(3_642_000);
    // H100 replica: 1 GPU, 8 vCPU, 64 GB, 200 GB = $2.1768/h.
    const h100 = container({ cpu: 8000, memMb: 65_536, storageMb: 204_800, gpu: { count: 1, class: "h100" } });
    expect(priceUsdPerHour("container", h100 as never)).toBeCloseTo(2.1768, 10);
    // Large tier: $1.20 per GPU.
    expect(priceUsdPerHour("container", container({ cpu: 100, memMb: 64, storageMb: 64, gpu: { count: 1, class: "large" } }) as never)).toBeCloseTo(1.2 + 0.001 + 0.000075 + 0.00000625, 10);
  });

  it("halves an interruptible workstation and never goes under the hosting price", () => {
    const ws = { ...container({ cpu: 8000, memMb: 65_536, storageMb: 204_800, gpu: { count: 1, class: "h100" } }), tier: "interruptible", maxHours: 1, access: { ssh: {} } };
    expect(priceUsdPerHour("workstation", ws as never)).toBeCloseTo(1.0884, 10);
    expect(priceUsdPerHour("container", container({ cpu: 100, memMb: 64, storageMb: 64 }) as never)).toBe(0.0014);
  });
});
