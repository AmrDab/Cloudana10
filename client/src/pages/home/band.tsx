// A full-height band over the scroll backdrop: kicker, one bold statement, one line, optional content.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Reveal, wrap } from "./parts";
import { useBackdrop } from "./backdrop";

export function Band({ id, photo, kicker, title, line, children, className }: {
  id: string;
  /** Index into the Backdrop photos; -1 for none. */
  photo: number;
  kicker: string;
  title: ReactNode;
  line?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const ref = useBackdrop(photo);
  return (
    <section ref={ref} id={id} aria-labelledby={`${id}-h`} className={cn("relative flex min-h-[88vh] items-center py-28 max-md:min-h-0 max-md:py-20", className)}>
      <div className={wrap}>
        <Reveal className="max-w-[760px]">
          <p className="font-mono text-xs uppercase tracking-[.14em] text-work">{kicker}</p>
          <h2 id={`${id}-h`} className="mt-4 font-head text-[clamp(40px,6.2vw,84px)] font-bold leading-[.98] tracking-[-.035em] text-text">
            {title}
          </h2>
          {line && <p className="mt-6 max-w-[48ch] text-lg leading-[1.5] text-muted-foreground md:text-xl">{line}</p>}
        </Reveal>
        {children && <div className="mt-10">{children}</div>}
      </div>
    </section>
  );
}
