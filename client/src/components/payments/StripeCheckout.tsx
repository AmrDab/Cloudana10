// Stripe checkout component — supports redirect and embedded Elements flows
// Uses VITE_STRIPE_PUBLISHABLE_KEY from env
import { useState, useEffect, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, CheckCircle2, ExternalLink, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckoutSession } from "@/lib/payments";

// ── Stripe init ───────────────────────────────────────────────────────────────

const stripeKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;

// Lazily initialized to avoid loading Stripe on every page
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripe() {
  if (!stripeKey) return null;
  if (!stripePromise) {
    stripePromise = loadStripe(stripeKey);
  }
  return stripePromise;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StripeCheckoutProps {
  /** Checkout session returned by the API */
  session: CheckoutSession | null;
  /** Preferred flow: "redirect" opens Stripe's hosted page; "embedded" renders Elements inline */
  mode?: "redirect" | "embedded";
  amountUsd: number;
  onSuccess?: (creditsAdded?: number) => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

// ── Main Component ────────────────────────────────────────────────────────────

export function StripeCheckout({
  session,
  mode = "redirect",
  amountUsd,
  onSuccess,
  onError,
  onCancel,
}: StripeCheckoutProps) {
  const [succeeded, setSucceeded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If no Stripe key is configured, show a warning
  if (!stripeKey) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Stripe is not configured. Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in your environment.
        </AlertDescription>
      </Alert>
    );
  }

  if (succeeded) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle2 className="h-12 w-12 text-green-500" />
        <p className="text-lg font-semibold">Payment successful!</p>
        <p className="text-sm text-muted-foreground">
          ${amountUsd.toFixed(2)} has been added to your account.
        </p>
        <Button variant="outline" onClick={() => onSuccess?.()}>
          Done
        </Button>
      </div>
    );
  }

  // ── Redirect flow ─────────────────────────────────────────────────────────

  if (mode === "redirect" || !session?.clientSecret) {
    return (
      <RedirectCheckout
        session={session}
        amountUsd={amountUsd}
        onCancel={onCancel}
      />
    );
  }

  // ── Embedded Elements flow ────────────────────────────────────────────────

  const stripe = getStripe();
  if (!stripe) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Failed to load Stripe.</AlertDescription>
      </Alert>
    );
  }

  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: session.clientSecret,
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "hsl(var(--primary))",
            colorBackground: "hsl(var(--background))",
            colorText: "hsl(var(--foreground))",
            borderRadius: "8px",
          },
        },
      }}
    >
      <EmbeddedPaymentForm
        amountUsd={amountUsd}
        onSuccess={(credits) => {
          setSucceeded(true);
          onSuccess?.(credits);
        }}
        onError={(msg) => {
          setError(msg);
          onError?.(msg);
        }}
        onCancel={onCancel}
      />
    </Elements>
  );
}

// ── Redirect Checkout ─────────────────────────────────────────────────────────

function RedirectCheckout({
  session,
  amountUsd,
  onCancel,
}: {
  session: CheckoutSession | null;
  amountUsd: number;
  onCancel?: () => void;
}) {
  const handleRedirect = useCallback(() => {
    if (session?.url) {
      window.location.href = session.url;
    }
  }, [session?.url]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-white/10 bg-muted/20 p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Amount</span>
          <span className="font-mono font-semibold">${amountUsd.toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Payment processor</span>
          <span>Stripe (secure)</span>
        </div>
      </div>

      {!session ? (
        <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Creating checkout session…</span>
        </div>
      ) : (
        <Button
          className="w-full"
          onClick={handleRedirect}
          disabled={!session.url}
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Continue to Stripe — ${amountUsd.toFixed(2)}
        </Button>
      )}

      {onCancel && (
        <Button variant="ghost" className="w-full" onClick={onCancel}>
          Cancel
        </Button>
      )}
    </div>
  );
}

// ── Embedded Payment Form (inner) ─────────────────────────────────────────────

function EmbeddedPaymentForm({
  amountUsd,
  onSuccess,
  onError,
  onCancel,
}: {
  amountUsd: number;
  onSuccess: (credits?: number) => void;
  onError: (msg: string) => void;
  onCancel?: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setIsSubmitting(true);
    setErrorMsg(null);

    const returnUrl = `${window.location.origin}/payment/success`;
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: returnUrl },
      redirect: "if_required",
    });

    if (error) {
      const msg = error.message ?? "Payment failed";
      setErrorMsg(msg);
      onError(msg);
      setIsSubmitting(false);
    } else if (paymentIntent?.status === "succeeded") {
      onSuccess();
    } else {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />

      {errorMsg && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errorMsg}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting || !stripe}>
        {isSubmitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing…
          </>
        ) : (
          `Pay $${amountUsd.toFixed(2)}`
        )}
      </Button>

      {onCancel && (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
      )}
    </form>
  );
}
