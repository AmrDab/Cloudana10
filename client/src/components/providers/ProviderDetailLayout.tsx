import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useWallet } from "@/context/wallet-context";
import { providerUrls } from "@/lib/provider-urls";
import type { ClientProviderDetail } from "@/lib/provider-types";
import { ProviderSummary } from "./ProviderSummary";
import { cn } from "@/lib/utils";

export enum ProviderDetailTabs {
  DETAIL = "1",
  RAW = "2",
}

type Props = {
  page: ProviderDetailTabs;
  provider: Partial<ClientProviderDetail> | null;
  address: string;
  refresh: () => void;
  children?: ReactNode;
};

export function ProviderDetailLayout({ children, page, address, provider, refresh }: Props) {
  const [, setLocation] = useLocation();
  const { userAddress, isConnected } = useWallet();
  // Only show owner-specific features when wallet is connected AND user is the owner
  const isOwner = isConnected && !!provider?.owner && userAddress && userAddress.toLowerCase() === provider.owner.toLowerCase();

  const handleTabChange = (value: string) => {
    switch (value as ProviderDetailTabs) {
      case ProviderDetailTabs.RAW:
        setLocation(providerUrls.detailRaw(address));
        break;
      case ProviderDetailTabs.DETAIL:
      default:
        setLocation(providerUrls.detail(address));
        break;
    }
  };

  function handleBackClick() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      setLocation(providerUrls.list());
    }
  }

  return (
    <div className="pb-12">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={handleBackClick}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">Provider detail</h1>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={() => refresh()}
          aria-label="Refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        {provider && isOwner && (
          <Link href={providerUrls.detailEdit(provider.owner as string)}>
            <Button variant="default" size="sm" className="rounded-full">
              Edit
            </Button>
          </Link>
        )}
      </div>

      {provider && (
        <>
          <ProviderSummary provider={provider as ClientProviderDetail} />

          <Tabs value={page} onValueChange={handleTabChange} className="w-full">
            <TabsList className="mt-0 grid w-full grid-cols-2 rounded-t-none border-b border-white/5 bg-transparent p-0">
              <TabsTrigger
                value={ProviderDetailTabs.DETAIL}
                className={cn(
                  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                )}
              >
                Detail
              </TabsTrigger>
              <TabsTrigger
                value={ProviderDetailTabs.RAW}
                className={cn(
                  "rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                )}
              >
                Raw Data
              </TabsTrigger>
            </TabsList>
            <div className="pt-6">{children}</div>
          </Tabs>
        </>
      )}
    </div>
  );
}
