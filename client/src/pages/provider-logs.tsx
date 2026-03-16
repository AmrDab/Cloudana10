import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { ProviderDetailLayout, ProviderDetailTabs } from "@/components/providers/ProviderDetailLayout";
import { useProviderDetail } from "@/hooks/useProviders";
import { useProviderLogs, useProviderDiagnostics, useProviderHealth } from "@/hooks/useProviderLogs";
import { RefreshCw, Activity, Server, HardDrive, Cpu, AlertCircle } from "lucide-react";

interface ProviderLogsPageProps {
  params?: { owner?: string };
}

export default function ProviderLogsPage({ params }: ProviderLogsPageProps) {
  const deviceIdParam = params?.owner ?? "";
  const deviceId = deviceIdParam ? decodeURIComponent(deviceIdParam) : "";
  const { data: provider, isLoading: providerLoading, refetch } = useProviderDetail(deviceId);
  
  // Convert deviceId to provider owner address from on-chain data
  const providerAddress = (provider?.owner || provider?.ownerAddress) as `0x${string}` | undefined;
  
  const { logs, stats, isLoading: logsLoading, error: logsError, refresh: refreshLogs } = useProviderLogs(providerAddress);
  const { diagnostics, isLoading: diagLoading, error: diagError, refresh: refreshDiag } = useProviderDiagnostics(providerAddress);
  const { health, isLoading: healthLoading, error: healthError, refresh: refreshHealth } = useProviderHealth(providerAddress);

  const [logFilter, setLogFilter] = useState<string | undefined>(undefined);

  if (!params || !deviceIdParam) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-10 w-10 text-primary" />
      </div>
    );
  }

  const refresh = () => {
    refetch();
    refreshLogs();
    refreshDiag();
    refreshHealth();
  };

  const filteredLogs = logs ? (logFilter ? logs.filter(log => log.level === logFilter) : logs) : [];

  return (
    <ProviderDetailLayout
      address={deviceId}
      page={ProviderDetailTabs.LOGS}
      refresh={refresh}
      provider={provider ?? null}
    >
      {providerLoading && (
        <div className="flex items-center justify-center py-16">
          <Spinner className="h-10 w-10 text-primary" />
        </div>
      )}

      {!providerLoading && !providerAddress && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              Provider Not Found
            </CardTitle>
            <CardDescription>
              This provider is not registered on-chain or the address could not be resolved.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {!providerLoading && providerAddress && (
        <div className="space-y-6">
          <Tabs defaultValue="diagnostics" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
              <TabsTrigger value="health">Health</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
            </TabsList>

            <TabsContent value="diagnostics" className="space-y-4 mt-4">
              {diagError && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="pt-6">
                    <p className="text-sm text-destructive">Error: {diagError.message}</p>
                  </CardContent>
                </Card>
              )}

              {diagLoading && (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="h-8 w-8 text-primary" />
                </div>
              )}

              {!diagLoading && diagnostics && (
                <div className="space-y-4">
                  {/* System Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Server className="h-5 w-5" />
                        System Information
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground">Device ID</span>
                        <p className="text-sm font-mono truncate">{diagnostics.deviceId.slice(0, 20)}...</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Platform</span>
                        <p className="text-sm">{diagnostics.system.platform} ({diagnostics.system.arch})</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Node Version</span>
                        <p className="text-sm">{diagnostics.system.nodeVersion}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Uptime</span>
                        <p className="text-sm">{Math.floor(diagnostics.system.uptimeSeconds / 3600)}h {Math.floor((diagnostics.system.uptimeSeconds % 3600) / 60)}m</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Health Status */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="h-5 w-5" />
                        Health Status
                        <Badge variant={
                          diagnostics.health.status === "healthy" ? "default" :
                          diagnostics.health.status === "degraded" ? "secondary" :
                          "destructive"
                        }>
                          {diagnostics.health.status.toUpperCase()}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <HardDrive className="h-3 w-3" />
                            Memory
                          </span>
                          <p className="text-sm">{diagnostics.health.checks.memory.percentUsed}% used</p>
                          <Badge variant={
                            diagnostics.health.checks.memory.status === "ok" ? "default" :
                            diagnostics.health.checks.memory.status === "warning" ? "secondary" :
                            "destructive"
                          } className="text-xs mt-1">
                            {diagnostics.health.checks.memory.status}
                          </Badge>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground flex items-center gap-1">
                            <Cpu className="h-3 w-3" />
                            CPU
                          </span>
                          <p className="text-sm">{diagnostics.health.checks.cpu.cores} cores</p>
                          <p className="text-xs text-muted-foreground truncate">{diagnostics.health.checks.cpu.model.slice(0, 30)}</p>
                        </div>
                        <div>
                          <span className="text-xs text-muted-foreground">Kubernetes</span>
                          <Badge variant={diagnostics.kubernetes.available ? "default" : "secondary"}>
                            {diagnostics.kubernetes.available ? "Available" : "Unavailable"}
                          </Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Workload Metrics */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Workload Metrics</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <span className="text-xs text-muted-foreground">Active</span>
                        <p className="text-2xl font-bold">{diagnostics.metrics.activeWorkloads}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Total Processed</span>
                        <p className="text-2xl font-bold">{diagnostics.metrics.totalWorkloads}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Successful</span>
                        <p className="text-2xl font-bold text-green-500">{diagnostics.metrics.successfulWorkloads}</p>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Failed</span>
                        <p className="text-2xl font-bold text-red-500">{diagnostics.metrics.failedWorkloads}</p>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Active Instances */}
                  {diagnostics.instances.count > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Active Workload Instances</CardTitle>
                        <CardDescription>{diagnostics.instances.count} running instance(s)</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {diagnostics.instances.list.map((inst, idx) => (
                            <div key={idx} className="flex items-center justify-between border-b border-border/50 pb-2 last:border-0">
                              <div>
                                <p className="text-sm font-medium">Workload {inst.workloadId} / Instance {inst.instanceId}</p>
                                {inst.namespace && (
                                  <p className="text-xs text-muted-foreground">Namespace: {inst.namespace}</p>
                                )}
                              </div>
                              <Badge variant={
                                inst.status === "running" ? "default" :
                                inst.status === "failed" ? "destructive" :
                                "secondary"
                              }>
                                {inst.status}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="health" className="space-y-4 mt-4">
              {healthError && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="pt-6">
                    <p className="text-sm text-destructive">Error: {healthError.message}</p>
                  </CardContent>
                </Card>
              )}

              {healthLoading && (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="h-8 w-8 text-primary" />
                </div>
              )}

              {!healthLoading && health && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      Health Check
                      <Badge variant={
                        health.status === "healthy" ? "default" :
                        health.status === "degraded" ? "secondary" :
                        "destructive"
                      }>
                        {health.status.toUpperCase()}
                      </Badge>
                    </CardTitle>
                    <CardDescription>Last checked: {new Date(health.timestamp).toLocaleString()}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <pre className="text-xs bg-muted/50 p-4 rounded overflow-auto max-h-96">
                      {JSON.stringify(health, null, 2)}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="logs" className="space-y-4 mt-4">
              {logsError && (
                <Card className="border-destructive/50 bg-destructive/5">
                  <CardContent className="pt-6">
                    <p className="text-sm text-destructive">Error: {logsError.message}</p>
                  </CardContent>
                </Card>
              )}

              <div className="flex items-center justify-between">
                <div className="flex gap-2">
                  <Button
                    variant={logFilter === undefined ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLogFilter(undefined)}
                  >
                    All
                  </Button>
                  <Button
                    variant={logFilter === "error" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLogFilter("error")}
                  >
                    Errors
                  </Button>
                  <Button
                    variant={logFilter === "warn" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLogFilter("warn")}
                  >
                    Warnings
                  </Button>
                  <Button
                    variant={logFilter === "info" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setLogFilter("info")}
                  >
                    Info
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={() => refreshLogs()} disabled={logsLoading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${logsLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {stats && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">Total Entries</span>
                        <p className="font-medium">{stats.totalEntries}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Errors</span>
                        <p className="font-medium text-red-500">{stats.levelCounts.error || 0}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Warnings</span>
                        <p className="font-medium text-yellow-500">{stats.levelCounts.warn || 0}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Info</span>
                        <p className="font-medium">{stats.levelCounts.info || 0}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {logsLoading && (
                <div className="flex items-center justify-center py-12">
                  <Spinner className="h-8 w-8 text-primary" />
                </div>
              )}

              {!logsLoading && filteredLogs.length > 0 && (
                <Card>
                  <CardContent className="pt-6">
                    <div className="space-y-2 max-h-[600px] overflow-y-auto">
                      {filteredLogs.slice().reverse().map((log, idx) => (
                        <div
                          key={idx}
                          className={`flex gap-2 text-xs font-mono border-l-2 pl-2 py-1 ${
                            log.level === "error" ? "border-red-500 bg-red-500/5" :
                            log.level === "warn" ? "border-yellow-500 bg-yellow-500/5" :
                            log.level === "info" ? "border-blue-500 bg-blue-500/5" :
                            "border-muted bg-muted/5"
                          }`}
                        >
                          <span className="text-muted-foreground whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          <Badge variant="outline" className="text-[10px] px-1 py-0">
                            {log.level}
                          </Badge>
                          <span className="text-muted-foreground">[{log.category}]</span>
                          <span className="flex-1">{log.message}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {!logsLoading && filteredLogs.length === 0 && logs && (
                <Card>
                  <CardContent className="pt-6 text-center text-muted-foreground">
                    No logs match the selected filter
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </ProviderDetailLayout>
  );
}
