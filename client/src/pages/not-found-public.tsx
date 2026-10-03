// Public 404 (anything outside /, /lab and /control). The console has its own.
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { btn } from "@/components/cld/cta";
import { Logo } from "@/components/cld/logo";

export default function PublicNotFound() {
  useEffect(() => {
    document.title = "404 · Cloudana";
  }, []);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-bg px-6 text-center text-text">
      <Logo />
      <div>
        <p className="font-mono text-xs uppercase tracking-[.14em] text-work">404</p>
        <h1 className="mt-4 font-head text-[clamp(40px,7vw,88px)] font-bold leading-[.96] tracking-[-.04em]">Proof not found.</h1>
        <p className="mt-5 max-w-[40ch] text-lg text-muted-foreground">That page isn't on the network. The pages that are:</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <a href="/" className={btn.primary()}>Home</a>
        <a href="/control" className={btn.ghost()}>Console <ArrowRight className="size-4" aria-hidden /></a>
        <a href="/lab" className={btn.ghost()}>Lab</a>
      </div>
    </main>
  );
}
