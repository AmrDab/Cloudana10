import { useState, useEffect, useRef } from "react";
import ProviderRegisterStaged from "@/pages/provider-register-staged";
import ProviderRegisterMultistep from "@/pages/provider-register-multistep";

const GUIDE_SEEN_KEY = "cloudana_provider_guide_seen";

function readGuideSeen(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(GUIDE_SEEN_KEY) === "true";
}

export default function ProviderRegisterPage() {
  const [guideSeen, setGuideSeenState] = useState(readGuideSeen);
  const registerSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setGuideSeenState(readGuideSeen());
  }, []);

  const setGuideSeenAndPersist = () => {
    setGuideSeenState(true);
    localStorage.setItem(GUIDE_SEEN_KEY, "true");
  };

  const handleGuideComplete = () => {
    setGuideSeenAndPersist();
    registerSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="max-w-6xl mx-auto py-10 px-4 space-y-8 animate-in fade-in duration-300">
      {/* Page header: same pattern as Provider Dashboard / other content pages */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Register provider</h1>
        <p className="mt-2 text-muted-foreground text-base">
          {guideSeen
            ? "Complete the form below to register and connect your provider to the Cloudana network."
            : "Follow the preparation guide below, then complete the registration form."}
        </p>
      </div>

      {/* Guide section: show once for new users, above the register form */}
      {!guideSeen && (
        <section className="mb-12">
          <ProviderRegisterStaged
            onGuideComplete={handleGuideComplete}
            onSkip={setGuideSeenAndPersist}
          />
        </section>
      )}

      {/* Register form: always shown on the same page */}
      <section
        id="provider-register-form"
        ref={registerSectionRef}
        className={guideSeen ? undefined : "scroll-mt-6"}
      >
        {!guideSeen && (
          <div className="mb-8 pt-6 border-t border-white/10">
            <h2 className="text-xl font-semibold text-primary mb-1">Registration form</h2>
            <p className="text-muted-foreground text-sm">
              Complete the form below to register and connect your provider to the Cloudana network.
            </p>
          </div>
        )}
        <ProviderRegisterMultistep />
      </section>
    </div>
  );
}
