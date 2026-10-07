// The waitlist form (docs/V2_BRIEF.md §3). One list for every branch; role follow-ups are optional
// and go into `details`. Success replaces the form with position + referral link.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_ROOT } from "@/lib/cld";
import { SERVICES, type ServiceId } from "@/lib/services";
import { Segmented, ToggleChips } from "@/components/cld/segmented";
import { CopyButton } from "@/components/cld/copy-button";
import { btn, monoLabel } from "@/components/cld/cta";
import { countries } from "./countries";
import { registerInline, signupSource, storedReferral, type WaitlistRole } from "./store";

const ROLES: { value: WaitlistRole; label: string }[] = [
  { value: "use", label: "Use" },
  { value: "provide", label: "Provide" },
  { value: "datacenter", label: "Datacenter" },
  { value: "verify", label: "Verify" },
  { value: "partner", label: "Partner" },
];
const ROLE_NAME: Record<WaitlistRole, string> = { use: "Use", provide: "Provide", datacenter: "Datacenter", verify: "Verify", partner: "Partner" };
const HARDWARE = ["Gaming PC (GPU)", "Workstation", "Home server / NAS", "Mac", "Other"];
const FLEET = ["< 50 servers", "50–500", "500+"];
const INTEREST_OPTIONS = SERVICES.map((s) => ({ value: s.id, label: s.name }));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Joined = { position: number; refCode: string; existing: boolean; role: WaitlistRole };
type Errors = Partial<Record<"email" | "role" | "consent" | "form", string>>;

const field = "h-11 w-full rounded-md border border-line-2 bg-bg-2 px-3 text-sm text-text placeholder:text-faint transition-colors duration-150 hover:border-faint aria-[invalid=true]:border-burn";
const errCls = "mt-1.5 text-sm text-burn";

export function WaitlistForm({
  defaultRole,
  defaultInterests,
  compact = false,
  inline = false,
}: {
  defaultRole?: WaitlistRole;
  defaultInterests?: ServiceId[];
  compact?: boolean;
  /** The page's main form: prefill requests from openWaitlist() scroll here instead of opening a dialog. */
  inline?: boolean;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<WaitlistRole | null>(defaultRole ?? null);
  const [interests, setInterests] = useState<ServiceId[]>(defaultInterests ?? []);
  const [hardware, setHardware] = useState("");
  const [fleet, setFleet] = useState("");
  const [useCase, setUseCase] = useState("");
  const [country, setCountry] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [joined, setJoined] = useState<Joined | null>(null);

  useEffect(() => {
    if (!inline) return;
    return registerInline((r) => {
      if (r.role) setRole(r.role);
      if (r.interests) setInterests(r.interests);
      root.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      setTimeout(() => emailRef.current?.focus({ preventScroll: true }), 400);
    });
  }, [inline]);

  const validate = (): Errors => {
    const e: Errors = {};
    if (!EMAIL_RE.test(email.trim())) e.email = "Enter a valid email address.";
    if (!role) e.role = "Pick how you'll join.";
    if (!consent) e.consent = "We need your OK to email you.";
    return e;
  };
  // Inline validation: on blur first, then on every change.
  useEffect(() => {
    if (Object.keys(touched).length) setErrors((prev) => ({ ...pick(validate(), touched), form: prev.form }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, role, consent, touched]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const all = { email: true, role: true, consent: true };
    setTouched(all);
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    const details: Record<string, string> = {};
    if (role === "provide" && hardware) details.hardware = hardware;
    if (role === "datacenter" && fleet) details.fleetSize = fleet;
    if (role === "partner" && useCase.trim()) details.useCase = useCase.trim().slice(0, 200);
    const body = {
      email: email.trim(),
      role,
      interests: role === "use" || role === "datacenter" ? interests : role === "verify" ? ["verify"] : undefined,
      details: Object.keys(details).length ? details : undefined,
      country: country || undefined,
      consent: true,
      newsletter: true,
      ref: storedReferral(),
      source: signupSource(),
      website: honeypot || undefined,
    };
    setPending(true);
    try {
      const res = await fetch(`${API_ROOT}/v1/waitlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 429) throw new Error("Too many attempts. Try again in a minute.");
      if (!res.ok || json?.status !== "success") {
        throw new Error(res.status === 400 && json?.error?.message ? json.error.message : "We couldn't save that. Your entry is kept in this tab — try again.");
      }
      setJoined({ position: json.position, refCode: json.refCode, existing: res.status === 200, role: role! });
    } catch (err) {
      const msg = err instanceof Error && !/fetch|abort|timeout|network/i.test(err.message) ? err.message : "We couldn't save that. Your entry is kept in this tab — try again.";
      setErrors((p) => ({ ...p, form: msg }));
    } finally {
      setPending(false);
    }
  }

  // Same root either way, so openWaitlist() after signing up scrolls to the success card.
  if (joined) return <div ref={root}><Success joined={joined} compact={compact} /></div>;

  const eid = (k: string) => `${id}-${k}-err`;
  return (
    <div ref={root}>
      <form onSubmit={submit} noValidate className={cn("grid", compact ? "gap-4" : "gap-5")} aria-label="Join the waitlist">
        <div>
          <label htmlFor={`${id}-email`} className={monoLabel}>Email</label>
          <input
            ref={emailRef}
            id={`${id}-email`}
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@domain.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, email: true }))}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? eid("email") : undefined}
            className={cn(field, "mt-2")}
          />
          <p id={eid("email")} className={errCls} aria-live="polite">{errors.email}</p>
        </div>

        <div>
          <span id={`${id}-role`} className={monoLabel}>I want to</span>
          <Segmented
            options={ROLES}
            value={role}
            onChange={(v) => {
              setRole(v);
              setTouched((t) => ({ ...t, role: true }));
            }}
            labelledBy={`${id}-role`}
            invalid={!!errors.role}
            describedBy={errors.role ? eid("role") : undefined}
            className="mt-2 w-full"
          />
          <p id={eid("role")} className={errCls} aria-live="polite">{errors.role}</p>
        </div>

        {role && role !== "verify" && (
          <div className="grid animate-in fade-in-0 slide-in-from-top-1 gap-2 duration-250">
            {(role === "use" || role === "datacenter") && (
              <>
                {role === "datacenter" && (
                  <Choice label="Fleet size" id={`${id}-fleet`} options={FLEET} value={fleet} onChange={setFleet} />
                )}
                <span id={`${id}-int`} className={cn(monoLabel, role === "datacenter" && "mt-2")}>Interested in (optional)</span>
                <ToggleChips options={INTEREST_OPTIONS} value={interests} onChange={setInterests} labelledBy={`${id}-int`} />
              </>
            )}
            {role === "provide" && <Choice label="Hardware (optional)" id={`${id}-hw`} options={HARDWARE} value={hardware} onChange={setHardware} />}
            {role === "partner" && (
              <>
                <label htmlFor={`${id}-uc`} className={monoLabel}>Use case (optional)</label>
                <input id={`${id}-uc`} maxLength={200} placeholder="What would you build or fund?" value={useCase} onChange={(e) => setUseCase(e.target.value)} className={field} />
              </>
            )}
          </div>
        )}

        {!compact && (
          <div>
            <label htmlFor={`${id}-country`} className={monoLabel}>Country (optional)</label>
            <select id={`${id}-country`} value={country} onChange={(e) => setCountry(e.target.value)} className={cn(field, "mt-2 appearance-none bg-[length:12px] pr-8", !country && "text-faint")}>
              <option value="">Select country</option>
              {countries().map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Honeypot: invisible to people, tempting to bots. */}
        <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Website
            <input tabIndex={-1} autoComplete="off" name="website" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
          </label>
        </div>

        <div>
          <label className="flex cursor-pointer items-start gap-3 text-sm leading-[1.5] text-muted-foreground">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                setTouched((t) => ({ ...t, consent: true }));
              }}
              aria-invalid={!!errors.consent}
              aria-describedby={errors.consent ? eid("consent") : undefined}
              className="mt-0.5 size-4 shrink-0 accent-[#3FD6C2]"
            />
            Email me about Cloudana. No third parties. Unsubscribe in one click.
          </label>
          <p id={eid("consent")} className={errCls} aria-live="polite">{errors.consent}</p>
        </div>

        <div>
          <button type="submit" disabled={pending} className={btn.primary("md", "w-full")}>
            {pending ? "Joining…" : "Join the waitlist"}
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4" aria-hidden />}
          </button>
          <p className={errCls} aria-live="polite">{errors.form}</p>
          <p className="mt-2 text-xs leading-[1.5] text-faint">
            {/* TODO(owner): confirm the privacy contact address. */}
            No tracking, no resale. Delete anytime — see <a className="underline underline-offset-2 hover:text-text" href="/privacy.html">Privacy</a>.
          </p>
        </div>
      </form>
    </div>
  );
}

function Choice({ label, id, options, value, onChange }: { label: string; id: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <>
      <span id={id} className={monoLabel}>{label}</span>
      <Segmented variant="chips" size="sm" options={options.map((o) => ({ value: o, label: o }))} value={value || null} onChange={onChange} labelledBy={id} />
    </>
  );
}

function Success({ joined, compact }: { joined: Joined; compact: boolean }) {
  const link = `${window.location.origin}/?r=${joined.refCode}`;
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I joined the Cloudana waitlist — a decentralized datacenter where the proof is the work. ${link}`)}`;
  const contact = joined.role === "datacenter" || joined.role === "partner";
  return (
    <div className="animate-in fade-in-0 duration-400" role="status">
      <p className={monoLabel}>{joined.existing ? "You're already on the list" : "You're in"}</p>
      <h3 className={cn("mt-2 font-head font-medium tracking-[-.03em] text-text", compact ? "text-[28px]" : "text-[40px] leading-[1.05]")}>
        You're #<span className="tabular-nums tracking-[-.03em] text-text">{joined.position.toLocaleString()}</span>.
      </h3>
      <p className="mt-2 text-sm text-muted-foreground">{ROLE_NAME[joined.role]} branch · we email when it opens.</p>

      <div className="mt-6">
        <label className={monoLabel} htmlFor="wl-ref">Your referral link</label>
        <div className="mt-2 flex gap-2">
          <input id="wl-ref" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={cn(field, "font-mono text-[13px]")} />
          <CopyButton text={link} className="h-11" />
        </div>
        <p className="mt-2 text-xs text-faint">Each signup from your link moves you up 5 places.</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {typeof navigator !== "undefined" && "share" in navigator && (
          <button type="button" className={btn.primary("sm", "sm:hidden")} onClick={() => navigator.share({ url: link }).catch(() => {})}>Share link</button>
        )}
        <a href={tweet} target="_blank" rel="noopener noreferrer" className={btn.ghost("sm")}>Share on X</a>
        {contact ? (
          <span className="text-sm text-muted-foreground">We'll reach out within 3 days.</span>
        ) : (
          <a href="/control" className={btn.link()}>Open the console <ArrowRight className="size-3.5" aria-hidden /></a>
        )}
      </div>
    </div>
  );
}

function pick<T extends object>(obj: T, keys: Record<string, boolean>): T {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys[k])) as T;
}
