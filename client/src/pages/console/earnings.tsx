// Console · Earnings (docs/V2_BRIEF.md §4). CLD is minted per verified job; the ledger shows each
// job's entry and where it is on the way to Base (pending → posted in a batch → settled).
import { ExternalLink, Wallet } from "lucide-react";
import { Link } from "wouter";
import { cld } from "@/lib/cld";
import {
  absTime, btn, Bone, Empty, Hash, MonoLabel, PageHeader, Panel, PanelHeader, Pill, RelTime, Tile, Unavailable, Updated,
  freshRow, useDelayed, useFreshIds,
} from "@/components/console/primitives";
import { isUnavailable, useLedger, useSession, type LedgerEntry } from "@/components/console/data";
import { signInWithToast } from "@/components/console/actions";

const LANE: Record<string, [string, "ok" | "work" | "chain" | "muted"]> = {
  A: ["A · fee", "ok"],
  B: ["B · subsidy", "work"],
  treasury: ["treasury", "muted"],
  verify: ["verifier credit", "chain"],
};
const STATUS: Record<string, "muted" | "work" | "chain" | "ok" | "burn"> = { pending: "muted", posted: "chain", settled: "ok", clawed: "burn" };
// The viewer's local time ("23 Oct 00:00"); the ledger header says so.
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const CLOCK = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const heldUntil = (ms: number) => `${DAY.format(ms)} ${CLOCK.format(ms)}`;
/** 86 400 → "24 h", 5 400 → "90 min". */
const duration = (s: number) => (s % 3600 === 0 ? `${s / 3600} h` : `${Math.round(s / 60)} min`);

export default function EarningsPage() {
  const session = useSession();
  if (!session) {
    return (
      <>
        <PageHeader kicker="Earnings" title="What your work has minted." />
        <Panel>
          <Empty
            icon={Wallet}
            title="Sign in to see CLD minted to your wallet for every job your nodes proved."
            action={<button type="button" className={btn.primary} onClick={() => signInWithToast()}>Sign in</button>}
          />
        </Panel>
      </>
    );
  }
  return <Earnings address={session.address} />;
}

function Earnings({ address }: { address: string }) {
  const ledger = useLedger(address);
  const l = ledger.data;
  const loading = ledger.isLoading;
  // `held`, `clawed` and the two settings are new in the API (B-6): read them defensively while an older API is deployed.
  const held = l ? (l.held?.A ?? 0) + (l.held?.B ?? 0) : null;
  const clawed = l ? (l.clawed?.A ?? 0) + (l.clawed?.B ?? 0) : 0;
  const inSettlement = l ? l.pending.A + l.pending.B - (held ?? 0) - l.vesting.B : null;
  const settled = l ? l.settled.A + l.settled.B : null;
  const sampleK = l?.verifySampleK;
  const holdSeconds = l?.payHoldSeconds ?? 0;
  const hold = holdSeconds > 0 ? duration(holdSeconds) : null;
  // Five tiles split 2 + 3 from md up (and the last one full width on a phone), so none is left alone on a row.
  const span = (wide: boolean, last = false) => (hold ? `${wide ? "md:col-span-3" : "md:col-span-2"}${last ? " max-md:col-span-2" : ""}` : undefined);
  return (
    <>
      <PageHeader
        kicker="Earnings"
        title="What your work has minted."
        lede={<span className="font-mono text-xs"><Hash value={address} head={8} tail={6} /></span>}
        right={
          <div className="flex items-center gap-3">
            <Updated at={ledger.dataUpdatedAt || null} offline={isUnavailable(ledger.error)} />
            <a className={btn.ghost} href={`https://sepolia.basescan.org/address/${address}`} target="_blank" rel="noopener noreferrer">
              Basescan <ExternalLink />
            </a>
          </div>
        }
      />
      <div className={`grid grid-cols-2 gap-3 ${hold ? "md:grid-cols-6" : "md:grid-cols-4"}`}>
        {hold && <Tile label="Held" value={held} unit="cld" loading={loading} tone="work" caption={`${hold} check window`} className={span(true)} />}
        <Tile label="In settlement" value={inSettlement} unit="cld" loading={loading} tone="chain" caption="Verified, batch not final" className={span(true)} />
        <Tile label="Vesting" value={l?.vesting.B} unit="cld" loading={loading} tone="work" caption="Subsidy, before it settles" className={span(false)} />
        <Tile label="Settled" value={settled} unit="cld" loading={loading} tone="ok" caption="Final on Base" className={span(false)} />
        <Tile label="Verifier credits" value={l?.credits} loading={loading} caption="Credits, not CLD" className={span(false, true)} />
      </div>
      <p className="mt-3 font-mono text-[12px] text-faint">
        Minted per verified job. Posted to Base in batches; subsidy vests first. The keeper claims for you once a batch is final.
      </p>
      {sampleK !== undefined && (
        <p className="mt-1 font-mono text-[12px] text-faint">
          Every answer is checked, and {sampleK <= 1 ? "every job is" : `1 job in ${sampleK} is`} re-executed in full.
          {hold && ` Pay is held ${hold} first and clawed if a re-executed job from any of your nodes fails.`}
        </p>
      )}
      {clawed > 0 && (
        <p className="mt-1 font-mono text-[12px] text-burn">Clawed: {cld(clawed)}, taken back after a failed check.</p>
      )}

      <Panel className="mt-6">
        <PanelHeader title="Ledger" kicker="Latest 50 entries · your local time" right={<Pill tone="ok">Claim · automatic</Pill>} />
        <LedgerTable entries={l?.entries} loading={loading} error={ledger.error} />
      </Panel>
    </>
  );
}

function LedgerTable({ entries, loading, error }: { entries?: LedgerEntry[]; loading: boolean; error: unknown }) {
  const showBone = useDelayed(loading);
  const fresh = useFreshIds(entries?.map((e) => e.id) ?? []);
  if (error) return isUnavailable(error) ? <Unavailable what="Your ledger" /> : <Empty icon={Wallet} title="Couldn't read the ledger. It retries on its own." />;
  if (loading)
    return showBone ? (
      <div className="grid gap-3 p-5">{Array.from({ length: 5 }, (_, i) => <Bone key={i} className="h-6 w-full" />)}</div>
    ) : (
      <div className="h-40" />
    );
  if (!entries?.length)
    return (
      <Empty
        icon={Wallet}
        title="Nothing earned yet. Bind a node or run the verifier."
        action={
          <>
            <Link href="/provide" className={btn.primary}>Bind a node</Link>
            <Link href="/verify" className={btn.ghost}>Start verifying</Link>
          </>
        }
      />
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm max-sm:min-w-0">
        <thead className="max-sm:hidden">
          <tr className="border-b border-line">
            {["Job", "Lane", "Amount", "Batch", "Status", "When"].map((h, i) => (
              <th key={h} className={`px-5 py-2.5 font-normal ${i === 2 ? "text-right" : ""}`}><MonoLabel>{h}</MonoLabel></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const [lane, tone] = LANE[e.lane] ?? [e.lane, "muted"];
            const amount = e.lane === "verify" ? `${e.amountUcld.toLocaleString("en-US")} pts` : cld(e.amountUcld);
            return (
              <tr key={e.id} className={`border-b border-line last:border-0 max-sm:grid max-sm:grid-cols-2 max-sm:gap-1 max-sm:px-5 max-sm:py-3 ${freshRow(fresh.has(e.id))}`}>
                <td className="px-5 py-3 max-sm:p-0"><Hash value={e.jobId} /></td>
                <td className="px-5 py-3 max-sm:p-0 max-sm:text-right"><Pill tone={tone}>{lane}</Pill></td>
                <td className="px-5 py-3 text-right font-mono tabular-nums text-text max-sm:p-0 max-sm:text-left">{amount}</td>
                <td className="px-5 py-3 font-mono text-[13px] tabular-nums text-muted-foreground max-sm:hidden">#{e.epoch}</td>
                <td className="px-5 py-3 max-sm:p-0 max-sm:text-right">
                  {e.releasesAt ? (
                    <Pill tone="work">
                      <span title={absTime(e.releasesAt)}>held<span className="max-sm:hidden"> until</span> {heldUntil(e.releasesAt)}</span>
                    </Pill>
                  ) : (
                    <Pill tone={STATUS[e.status] ?? "muted"}>{e.status}</Pill>
                  )}
                </td>
                <td className="px-5 py-3 max-sm:hidden"><RelTime ms={e.createdAt} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
