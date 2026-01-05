import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useAccount } from "wagmi";
import { useLocation } from "wouter";
import { Server, Coins, Settings, Activity } from "lucide-react";
import { useMyProviders, useProviderCredit } from "@/lib/contracts";
import { formatEther } from "viem";

export default function ProviderDashboard() {
  const { address, isConnected } = useAccount();
  const [, setLocation] = useLocation();
  
  const { data: myProviderKeys } = useMyProviders(address);
  const { data: providerCredit } = useProviderCredit(address);
  
  const isProvider = myProviderKeys && Array.isArray(myProviderKeys) && myProviderKeys.length > 0;
  const creditAmount = providerCredit && typeof providerCredit === 'bigint' ? parseFloat(formatEther(providerCredit)) : 0;

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <h2 className="text-2xl font-bold mb-4">Access Restricted</h2>
        <p className="text-muted-foreground mb-4">Please connect your wallet to view provider dashboard.</p>
      </div>
    );
  }

  if (!isProvider) {
    return (
      <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500 pt-10">
        <Card className="glass-card border-primary/20 text-center py-10">
          <CardHeader>
            <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Server className="h-8 w-8 text-primary" />
            </div>
            <CardTitle className="text-3xl">Become a Provider</CardTitle>
            <CardDescription className="text-lg">Register your machine to the Cloudana network and start earning CLD.</CardDescription>
          </CardHeader>
          <CardContent className="max-w-md mx-auto space-y-4 text-left">
            <p className="text-sm text-muted-foreground text-center">
              Register your compute node with full device specifications. You'll need to provide detailed information about your hardware.
            </p>

            <Button 
              onClick={() => setLocation("/provider/register")} 
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-lg"
            >
              Register Provider
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Active Provider View
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Provider Dashboard</h1>
          <p className="text-muted-foreground">Monitor your node performance and earnings.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            onClick={() => setLocation("/provider/register")}
            className="border-primary/20 hover:bg-primary/10"
          >
            <Server className="h-4 w-4 mr-2" />
            Register New Provider
          </Button>
          <Badge variant="outline" className="border-green-500 text-green-500 bg-green-500/10 px-3 py-1">
            <Activity className="w-3 h-3 mr-2 animate-pulse" /> Node Active
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Earnings Card */}
        <Card className="lg:col-span-2 glass-card bg-gradient-to-br from-card to-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-yellow-400" /> Accumulated Earnings
            </CardTitle>
            <CardDescription>CLD tokens earned from completed jobs.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-6xl font-bold font-mono tracking-tighter text-yellow-400 drop-shadow-[0_0_15px_rgba(250,204,21,0.3)]">
                {creditAmount.toFixed(2)}
              </span>
              <span className="text-xl text-muted-foreground font-mono">CLD</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button 
              className="bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 border border-yellow-400/20"
              disabled={creditAmount === 0}
            >
              Withdraw Earnings
            </Button>
          </CardFooter>
        </Card>

        {/* Status Card */}
        <Card className="bg-card/50 border-white/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-foreground" /> Configuration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center p-3 rounded bg-white/5">
              <span className="text-sm text-muted-foreground">Status</span>
              <Switch checked={true} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Registered Nodes</Label>
              <div className="text-2xl font-bold">
                {myProviderKeys?.length || 0}
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              className="w-full"
              onClick={() => setLocation("/provider/register")}
            >
              Register New Node
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Assigned Jobs List */}
      <Card className="border-white/5 bg-card/40">
        <CardHeader>
          <CardTitle>Assigned Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          {/* <Table>
            <TableHeader>
              <TableRow className="hover:bg-white/5 border-white/10">
                <TableHead>Job ID</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Deposited</TableHead>
                <TableHead>Spent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
          </Table> */}
        </CardContent>
      </Card>
    </div>
  );
}
