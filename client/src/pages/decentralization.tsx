/**
 * Decentralization Status — public transparency page.
 * Route: /control/decentralization
 *
 * Honestly shows what is decentralized vs centralized today, and the roadmap to a
 * network that runs without us. Data lives in src/data/decentralization.ts (mirrors
 * DECENTRALIZATION_ROADMAP.md).
 */

import { motion, type Variants } from "framer-motion";
import { ShieldCheck, ShieldAlert, ShieldX, CircleDot, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LITMUS_TEST,
  COMPONENTS,
  PHASES,
  COMMITMENTS,
  type DecentralizationLevel,
  type LitmusStatus,
} from "@/data/decentralization";

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

const LEVEL_META: Record<
  DecentralizationLevel,
  { label: string; dot: string; pill: string; Icon: typeof ShieldCheck }
> = {
  decentralized: { label: "Decentralized", dot: "bg-emerald-500", pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30", Icon: ShieldCheck },
  hybrid: { label: "Hybrid", dot: "bg-amber-500", pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30", Icon: ShieldAlert },
  centralized: { label: "Centralized", dot: "bg-rose-500", pill: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30", Icon: ShieldX },
};

const LITMUS_META: Record<LitmusStatus, { label: string; pill: string }> = {
  fail: { label: "Litmus: FAIL", pill: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30" },
  partial: { label: "Litmus: PARTIAL", pill: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30" },
  pass: { label: "Litmus: PASS", pill: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" },
};

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export default function DecentralizationPage() {
  const counts = COMPONENTS.reduce(
    (acc, c) => ({ ...acc, [c.level]: acc[c.level] + 1 }),
    { decentralized: 0, hybrid: 0, centralized: 0 } as Record<DecentralizationLevel, number>,
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
      {/* Header */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} className="space-y-4">
        <Pill className={LEVEL_META.hybrid.pill}>
          <CircleDot className="h-3 w-3" /> Progressively decentralizing
        </Pill>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Decentralization Status</h1>
        <p className="max-w-3xl text-muted-foreground">
          We're building a network that, over time, runs without us. We're not fully there yet — and we
          won't pretend to be. Here's the honest picture of what's decentralized today and the path forward.
        </p>
      </motion.div>

      {/* Litmus test */}
      <motion.div initial="hidden" animate="visible" variants={fadeUp} className="mt-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col gap-2 p-6">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The test we hold ourselves to</span>
            <p className="text-lg font-medium leading-snug">“{LITMUS_TEST}”</p>
            <p className="text-sm text-muted-foreground">
              Today the honest answer is <span className="font-semibold text-rose-600 dark:text-rose-400">no</span> — your
              on-chain balance and registrations survive, but new job matching and reward issuance still depend on us.
              Each phase below moves that answer toward <span className="font-semibold text-emerald-600 dark:text-emerald-400">yes</span>.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Today's component status */}
      <section className="mt-12">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Where we are today</h2>
          <div className="flex flex-wrap gap-2">
            <Pill className={LEVEL_META.decentralized.pill}>{counts.decentralized} decentralized</Pill>
            <Pill className={LEVEL_META.hybrid.pill}>{counts.hybrid} hybrid</Pill>
            <Pill className={LEVEL_META.centralized.pill}>{counts.centralized} centralized</Pill>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {COMPONENTS.map((c) => {
            const meta = LEVEL_META[c.level];
            return (
              <motion.div key={c.name} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}>
                <Card className="h-full">
                  <CardContent className="flex gap-3 p-4">
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{c.name}</span>
                      </div>
                      <Pill className={meta.pill}>
                        <meta.Icon className="h-3 w-3" /> {meta.label}
                      </Pill>
                      <p className="text-sm text-muted-foreground">{c.detail}</p>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Roadmap */}
      <section className="mt-14">
        <h2 className="mb-1 text-xl font-semibold">The road to fully decentralized</h2>
        <p className="mb-6 text-sm text-muted-foreground">
          Phases are technical gates, not fixed dates. We advance only when the litmus test improves.
        </p>
        <div className="relative space-y-4 border-l border-border pl-6">
          {PHASES.map((p) => {
            const lit = LITMUS_META[p.litmus];
            return (
              <motion.div key={p.id} initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeUp}>
                <span
                  className={`absolute -left-[7px] mt-2 h-3.5 w-3.5 rounded-full border-2 border-background ${
                    p.current ? "bg-primary" : "bg-muted-foreground/40"
                  }`}
                />
                <Card className={p.current ? "border-primary/40" : undefined}>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="text-base">
                        {p.name}
                        {p.current && (
                          <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">You are here</span>
                        )}
                      </CardTitle>
                      <Pill className={lit.pill}>{lit.label}</Pill>
                    </div>
                    <p className="text-xs text-muted-foreground">{p.tagline}</p>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <ul className="space-y-1.5">
                      {p.changes.map((ch, i) => (
                        <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                          <span>{ch}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Exit criteria:</span> {p.exit}
                    </p>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* Commitments */}
      <section className="mt-14">
        <h2 className="mb-4 text-xl font-semibold">Our transparency commitments</h2>
        <Card>
          <CardContent className="p-6">
            <ul className="space-y-3">
              {COMMITMENTS.map((c, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  <span className="text-muted-foreground">{c}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <p className="mt-4 text-xs text-muted-foreground">
          Full detail in the{" "}
          <a
            href="https://github.com/AmrDab/Cloudana10/blob/main/DECENTRALIZATION_ROADMAP.md"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            decentralization roadmap
          </a>
          .
        </p>
      </section>
    </div>
  );
}
