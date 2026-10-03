// Live strip: the network exists; numbers are honest (zero is zero, offline is "—").
import { useEffect, useState } from "react";
import { useNetwork } from "@/hooks/useNetwork";
import { fetchLatestBlock, type Block } from "@/lib/miner";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { wrap } from "./parts";

function Stat({ label, value, decimals = 0, unit }: { label: string; value: number | null; decimals?: number; unit?: string }) {
  return (
    <div className="min-w-0 px-5 py-6 max-sm:px-4">
      <dt className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-1.5 font-mono text-[28px] leading-none tabular-nums text-text max-sm:text-[22px]">
        {value == null ? <span className="text-faint">—</span> : <NumberTicker value={value} decimalPlaces={decimals} className="tracking-normal text-text" />}
        {unit && value != null && <span className="text-xs text-faint">{unit}</span>}
      </dd>
    </div>
  );
}

function useBaseBlock() {
  const [block, setBlock] = useState<Block | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetchLatestBlock().then((b) => alive && b && setBlock(b));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return block;
}

export function LiveStrip() {
  const { data, offline } = useNetwork();
  const block = useBaseBlock();
  const cldOf = (u?: number) => (u == null ? null : u / 1e6);
  return (
    <section aria-label="Live network numbers" className="border-y border-line bg-bg-2">
      <div className={wrap}>
        <dl className="grid grid-cols-6 divide-x divide-line max-lg:grid-cols-3 max-lg:divide-y max-sm:grid-cols-2">
          <Stat label="Nodes online" value={data?.nodesOnline ?? null} />
          <Stat label="Verified jobs" value={data?.certificates ?? null} />
          <Stat label="CLD minted" value={cldOf(data?.mintedUcld)} decimals={2} />
          <Stat label="CLD burned" value={cldOf(data?.burnedUcld)} decimals={2} />
          <Stat label="Verifiers today" value={data?.verifiersToday ?? null} />
          <div className="min-w-0 px-5 py-6 max-sm:px-4">
            <dt className="font-mono text-[11px] uppercase tracking-[.08em] text-faint">Base Sepolia</dt>
            <dd className="mt-2 font-mono text-[22px] leading-none tabular-nums max-sm:text-[18px]">
              {block ? (
                <a href={`https://sepolia.basescan.org/block/${block.number}`} target="_blank" rel="noopener noreferrer" className="text-chain underline-offset-4 hover:underline">
                  #{block.number.toLocaleString("en-US")}
                </a>
              ) : (
                <span className="text-faint">—</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="border-t border-line py-2.5 text-right font-mono text-[11px] text-faint">
          {offline ? "api offline — numbers appear when it answers." : "Read every 15 s. Zero is shown as zero."}
        </p>
      </div>
    </section>
  );
}
