// Template detail — a right-hand sheet: README, resources, price/hour estimate, then the deploy form in place.
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ExternalLink, Rocket } from "lucide-react";
import { cn } from "@/lib/utils";
import { cld } from "@/lib/cld";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { btn, MonoLabel } from "@/components/console/primitives";
import { useTemplate } from "@/components/console/data";
import { containerDefaults, kindOf, mb, priceEstimate, SIZES, sizeFor } from "./model";
import { KindPill, TemplateLogo, type ListedTemplate } from "./templates";
import { DeployForm } from "./deploy-form";

/** `template` null + open → the blank "Paste HTML" static form. */
export function TemplateSheet({ open, template, onOpenChange, onDeployed }: {
  open: boolean;
  template: ListedTemplate | null;
  onOpenChange: (o: boolean) => void;
  onDeployed: (id: string) => void;
}) {
  const [step, setStep] = useState<"detail" | "form">("detail");
  const showForm = !template || step === "form";
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setStep("detail");
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto border-line-2 bg-panel p-0 sm:max-w-[560px]">
        {template ? (
          <SheetHeader className="space-y-0 border-b border-line px-6 py-5 text-left">
            <div className="flex items-start gap-3 pr-8">
              <TemplateLogo t={template} />
              <div className="min-w-0 flex-1">
                <SheetTitle className="font-head text-lg font-medium text-text">{template.name}</SheetTitle>
                <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">{template.summary}</SheetDescription>
              </div>
              <KindPill kind={kindOf(template)} />
            </div>
          </SheetHeader>
        ) : (
          <SheetHeader className="space-y-0 border-b border-line px-6 py-5 text-left">
            <SheetTitle className="font-head text-lg font-medium text-text">Static site</SheetTitle>
            <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">Upload a folder or paste one HTML file. The orchestrator places it on a capable node.</SheetDescription>
          </SheetHeader>
        )}
        {showForm ? (
          <>
            {template && (
              <button type="button" className={cn(btn.quiet, "mx-4 mt-3")} onClick={() => setStep("detail")}>
                <ArrowLeft /> Back to details
              </button>
            )}
            <DeployForm
              key={template?.id ?? "blank"}
              template={template}
              onDone={(id) => {
                onOpenChange(false);
                setStep("detail");
                onDeployed(id);
              }}
            />
          </>
        ) : (
          <Detail t={template!} onDeploy={() => setStep("form")} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Detail({ t, onDeploy }: { t: ListedTemplate; onDeploy: () => void }) {
  const full = useTemplate(t.readme ? null : t.id);
  const readme = t.readme || full.data?.readme || "";
  const kind = kindOf(t);
  const d = useMemo(() => containerDefaults(t), [t]);
  const size = sizeFor(d);
  const price = priceEstimate(kind, SIZES[size]);

  return (
    <div className="space-y-6 px-6 py-5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line font-mono text-[12px] sm:grid-cols-4">
        {(kind === "static"
          ? [["Kind", "Static"], ["Files", t.files?.length ? String(t.files.length) : "—"], ["Limit", "2 MB"], ["Price / h", `≈ ${cld(price)}`]]
          : [
              ["CPU", d.cpu != null ? `${+(d.cpu / 1000).toFixed(2)} vCPU` : "—"],
              ["Memory", d.memMb != null ? mb(d.memMb) : "—"],
              ["Storage", d.storageMb != null ? mb(d.storageMb) : "—"],
              ["Price / h", `≈ ${cld(price)}`],
            ]
        ).map(([k, v]) => (
          <div key={k} className="bg-bg-2 px-3 py-2.5">
            <dt className="text-faint">{k}</dt>
            <dd className="mt-0.5 tabular-nums text-text">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-3 text-[12px] leading-4 text-faint">
        Price is an estimate from the protocol's default rates{kind === "container" ? ` at the ${size === "S" ? "smallest" : size === "M" ? "medium" : "largest"} size` : ""}; the orchestrator sets the live price and holds the first hour from your balance.
        {kind === "container" && d.image && <> Image <span className="font-mono text-muted-foreground">{d.image}</span>.</>}
        {kind === "container" && <> Containers are early access: they start only when a Docker-capable node is online; until then the deployment waits.</>}
        {!!t.secretEnv?.length && <> Asks for secrets <span className="font-mono text-muted-foreground">{t.secretEnv.join(", ")}</span>, sealed in your browser to the assigned node.</>}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn.primary} onClick={onDeploy}>
          <Rocket /> Deploy
        </button>
        {t.githubUrl && (
          <a href={t.githubUrl} target="_blank" rel="noopener noreferrer" className={btn.ghost}>
            <ExternalLink /> Source
          </a>
        )}
      </div>

      <section aria-label="README">
        <MonoLabel>README</MonoLabel>
        <div className="mt-3 border-t border-line pt-4">
          {readme ? <Markdown src={readme} /> : <p className="text-sm text-faint">{full.isLoading ? "Loading…" : "This template has no README."}</p>}
        </div>
      </section>
    </div>
  );
}

// ── Minimal markdown: headings, paragraphs, lists, fenced code, inline code/bold. HTML and images are dropped. ──
function Markdown({ src }: { src: string }) {
  const blocks: ReactNode[] = [];
  const lines = src.replace(/\r/g, "").replace(/<[^>]+>/g, "").split("\n");
  let para: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length} className="text-[13.5px] leading-[1.6] text-muted-foreground">{inline(para.join(" "))}</p>);
    if (list.length) blocks.push(<ul key={blocks.length} className="list-disc space-y-1 pl-5 text-[13.5px] leading-[1.6] text-muted-foreground">{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    para = [];
    list = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      while (++i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i]);
      blocks.push(<pre key={blocks.length} className="overflow-x-auto rounded-md border border-line bg-bg-2 p-3 font-mono text-[12px] leading-[1.6] text-text">{code.join("\n")}</pre>);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flush();
      const cls = h[1].length <= 1 ? "text-[17px]" : h[1].length === 2 ? "text-[15px]" : "text-[14px]";
      blocks.push(<h3 key={blocks.length} className={cn("font-head font-medium text-text", cls)}>{inline(h[2])}</h3>);
      continue;
    }
    const li = l.match(/^\s*(?:[-*+]|\d+\.)\s+(.*)/);
    if (li) {
      if (para.length) flush();
      list.push(li[1]);
      continue;
    }
    if (!l.trim()) flush();
    else para.push(l.trim());
  }
  flush();
  return <div className="space-y-3">{blocks}</div>;
}

function inline(s: string): ReactNode[] {
  // Images go; links keep their text.
  const text = s.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("`") && part.endsWith("`") && part.length > 1 ? (
      <code key={i} className="rounded bg-bg-2 px-1 py-0.5 font-mono text-[12px] text-text">{part.slice(1, -1)}</code>
    ) : part.startsWith("**") && part.endsWith("**") && part.length > 3 ? (
      <strong key={i} className="font-medium text-text">{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  );
}
