// The universe as a semantic nested list: the reduced-motion / no-canvas fallback, the sr-only outline for
// screen readers and crawlers, and the mobile list in the shell (which passes onFly).
import { ArrowRight } from "lucide-react";
import { StatusChip } from "@/components/cld/status-chip";
import { btn } from "@/components/cld/cta";
import { openWaitlist } from "@/components/waitlist";
import type { ServiceId } from "@/lib/services";
import { wrap } from "../parts";
import { childrenOf, GRAPH, NODE_INDEX } from "./graph";
import type { LiveValue, NodeId, Tone, UNode } from "./types";

type Props = { live?: Partial<Record<NodeId, LiveValue>>; onFly?: (id: NodeId) => void };

const TONE_TEXT: Record<Tone, string> = { ok: "text-ok", work: "text-work", chain: "text-chain", burn: "text-burn", neutral: "text-text" };
const TONE_DOT: Record<Tone, string> = { ok: "bg-ok", work: "bg-work", chain: "bg-chain", burn: "bg-burn", neutral: "bg-faint/60" };

const isExternal = (href: string) => /^https?:\/\//.test(href);

function Name({ node, onFly, className }: { node: UNode; onFly?: (id: NodeId) => void; className: string }) {
  const label = node.hidden ? "?????" : node.label;
  if (!onFly) return <span className={className}>{label}</span>;
  return (
    <button type="button" onClick={() => onFly(node.id)} className={`${className} text-left underline-offset-4 hover:underline`}>
      {label}
    </button>
  );
}

function Live({ value }: { value?: LiveValue }) {
  if (!value) return null;
  return <span className={`font-mono text-xs ${value.intensity > 0 ? "text-ok" : "text-faint"}`}>{value.text}</span>;
}

function Open({ node }: { node: UNode }) {
  if (!node.href) return null;
  const ext = isExternal(node.href);
  return (
    <a href={node.href} className={btn.link()} {...(ext ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {node.hrefLabel ?? "Open"} <ArrowRight className="size-3.5" />
    </a>
  );
}

function Waitlist({ node }: { node: UNode }) {
  if (!node.interest || node.status === "live") return null;
  const interest = node.interest as ServiceId;
  return (
    <button type="button" onClick={() => openWaitlist({ interests: [interest] })} className={btn.ghost("sm", "h-8 px-2.5 text-xs")}>
      Join the waitlist
    </button>
  );
}

function Leaf({ node, live, onFly }: { node: UNode; live?: LiveValue; onFly?: Props["onFly"] }) {
  const tone = node.tone ?? "neutral";
  return (
    <li className="grid gap-1 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <i className={`size-1.5 rounded-full ${TONE_DOT[tone]}`} aria-hidden />
        <Name node={node} onFly={onFly} className="font-head text-sm text-text" />
        {node.status && <StatusChip status={node.status} />}
        <Live value={live} />
      </div>
      {!node.hidden && node.summary && <p className="pl-[18px] text-sm leading-[1.55] text-muted-foreground">{node.summary}</p>}
      {!node.hidden && node.body?.map((line) => (
        <p key={line} className="pl-[18px] text-xs leading-[1.55] text-faint">{line}</p>
      ))}
      {!node.hidden && (node.href || node.interest) && (
        <div className="flex flex-wrap items-center gap-3 pl-[18px] pt-1">
          <Open node={node} />
          <Waitlist node={node} />
        </div>
      )}
    </li>
  );
}

function Topic({ node, live, onFly }: { node: UNode; live?: Props["live"]; onFly?: Props["onFly"] }) {
  const leaves = childrenOf(node.id);
  const tone = node.tone ?? "neutral";
  return (
    <li className="rounded-lg border border-line-2 bg-panel p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Name node={node} onFly={onFly} className={`font-head text-lg font-semibold ${TONE_TEXT[tone]}`} />
        {node.status && <StatusChip status={node.status} />}
        <Live value={live?.[node.id]} />
      </div>
      {!node.hidden && node.summary && <p className="mt-1 max-w-[70ch] text-sm leading-[1.55] text-muted-foreground">{node.summary}</p>}
      {!node.hidden && node.body?.map((line) => (
        <p key={line} className="mt-1 max-w-[70ch] text-xs leading-[1.55] text-faint">{line}</p>
      ))}
      {!node.hidden && (node.href || node.interest) && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Open node={node} />
          <Waitlist node={node} />
        </div>
      )}
      {leaves.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {leaves.map((l) => <Leaf key={l.id} node={l} live={live?.[l.id]} onFly={onFly} />)}
        </ul>
      )}
    </li>
  );
}

function Region({ node, live, onFly }: { node: UNode; live?: Props["live"]; onFly?: Props["onFly"] }) {
  const tone = node.tone ?? "neutral";
  return (
    <li id={`list-${node.id}`} className="scroll-mt-20">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="font-head text-[clamp(28px,3.6vw,40px)] font-bold leading-[1.05] tracking-[-.03em]">
          <Name node={node} onFly={onFly} className={TONE_TEXT[tone]} />
        </h2>
        <Live value={live?.[node.id]} />
      </div>
      {node.summary && <p className="mt-3 max-w-[56ch] text-base leading-[1.55] text-muted-foreground">{node.summary}</p>}
      {node.body?.map((line) => (
        <p key={line} className="mt-1 max-w-[70ch] text-sm leading-[1.55] text-faint">{line}</p>
      ))}
      {node.href && <div className="mt-4"><Open node={node} /></div>}
      <ul className="mt-8 grid gap-4">
        {childrenOf(node.id).map((t) => <Topic key={t.id} node={t} live={live} onFly={onFly} />)}
      </ul>
    </li>
  );
}

export function ListView({ live, onFly }: Props) {
  const root = NODE_INDEX[GRAPH.root];
  return (
    <nav aria-label="Map of Cloudana" className={`${wrap} py-16 text-text`}>
      <header>
        <p className="font-mono text-xs uppercase tracking-[.08em] text-work">Cloudana</p>
        <h1 className="mt-3 font-head text-[clamp(36px,5vw,64px)] font-bold leading-[1.02] tracking-[-.03em]">
          <Name node={root} onFly={onFly} className="text-text" />
        </h1>
        {root.summary && <p className="mt-4 max-w-[56ch] text-lg leading-[1.5] text-muted-foreground">{root.summary}</p>}
        {root.body?.map((line) => (
          <p key={line} className="mt-1 max-w-[70ch] text-sm leading-[1.55] text-faint">{line}</p>
        ))}
        {root.href && <div className="mt-5"><a href={root.href} className={btn.primary()}>{root.hrefLabel ?? "Open"}</a></div>}
      </header>
      <ul className="mt-20 grid gap-20 max-md:mt-12 max-md:gap-12">
        {childrenOf(root.id).map((r) => <Region key={r.id} node={r} live={live} onFly={onFly} />)}
      </ul>
    </nav>
  );
}
