import { useProviderEvents } from '@/hooks/useProviderEvents';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw, Activity, ExternalLink } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Real-time Provider Events Monitor Component
 * 
 * Connects directly to blockchain for real-time provider registration events
 * DePIN Architecture: Direct blockchain connection → No backend needed
 */
export function ProviderEventsMonitor() {
  const { providers, loading, error, connected, refetch } = useProviderEvents({
    loadHistorical: false, // Real-time only by default
    onNewProvider: (provider) => {
      // Show toast notification for new providers
      console.log('🎉 New provider registered:', provider.region);
      // You can add toast notification here with: toast.success(`New ${provider.region} provider!`)
    }
  });

  const getHardwareTierLabel = (tier: number): string => {
    const tiers = ['Basic', 'Standard', 'Professional'];
    return tiers[tier] || 'Unknown';
  };

  const getHardwareTierColor = (tier: number): string => {
    const colors = ['bg-gray-500', 'bg-blue-500', 'bg-purple-500'];
    return colors[tier] || 'bg-gray-500';
  };

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-destructive" />
            Error Loading Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button onClick={refetch} className="mt-4" variant="outline">
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Activity className={`h-5 w-5 ${connected ? 'text-green-500 animate-pulse' : 'text-gray-400'}`} />
              Live Provider Feed
              {!connected && <span className="text-sm font-normal text-muted-foreground">(Connecting...)</span>}
            </CardTitle>
            <CardDescription>
              Real-time provider registrations {connected ? '• Connected to Blockchain' : '• Connecting to Blockchain'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {providers.length} Total
            </Badge>
            <Button
              onClick={refetch}
              variant="ghost"
              size="sm"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading && providers.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-2">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Loading provider events...
              </p>
            </div>
          </div>
        ) : providers.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Activity className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>No provider registrations found</p>
            <p className="text-sm mt-2">
              Events will appear here when providers register
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="p-4 border rounded-lg bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-2">
                    {/* Header */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={`${getHardwareTierColor(provider.hardwareTier)} text-white`}>
                        {getHardwareTierLabel(provider.hardwareTier)}
                      </Badge>
                      <Badge variant="outline">
                        {provider.region}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Block #{provider.blockNumber}
                      </span>
                    </div>

                    {/* Provider Details */}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                      <div>
                        <span className="text-muted-foreground">Owner:</span>{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">
                          {provider.ownerShort}
                        </code>
                      </div>
                      <div>
                        <span className="text-muted-foreground">PubKey:</span>{' '}
                        <code className="text-xs bg-muted px-1 py-0.5 rounded">
                          {provider.pubKeyHashShort}
                        </code>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Capacity:</span>{' '}
                        <span className="font-semibold">{provider.capacity}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Bond:</span>{' '}
                        <span className="font-semibold">
                          {provider.bondAmountFormatted} CLD
                        </span>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                      <span>⏰ {provider.timestamp}</span>
                      <a
                        href={`https://sepolia.basescan.org/tx/${provider.transactionHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 hover:text-primary transition-colors"
                      >
                        View TX <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>

                  {/* Capacity Badge */}
                  <div className="text-center">
                    <div className="text-3xl font-bold text-primary">
                      {provider.capacity}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Capacity
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

