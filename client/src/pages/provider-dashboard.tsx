import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useWallet } from "@/context/wallet-context";
import { MOCK_JOBS } from "@/lib/mock-data";
import { useLocation } from "wouter";
import { Server, Coins, Settings, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

export default function ProviderDashboard() {
  const { isConnected, isProvider, registerAsProvider } = useWallet();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [metaHash, setMetaHash] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <h2 className="text-2xl font-bold mb-4">Access Restricted</h2>
        <p className="text-muted-foreground mb-4">Please connect your wallet to view provider dashboard.</p>
      </div>
    );
  }

  const handleRegister = () => {
    if (!metaHash) return;
    setIsRegistering(true);
    registerAsProvider(metaHash);
    setTimeout(() => setIsRegistering(false), 1000); // Context handles the rest
  };

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
            <div className="space-y-2">
              <Label htmlFor="metahash">Provider Metadata Hash (IPFS)</Label>
              <Input 
                id="metahash" 
                placeholder="ipfs://Qm..." 
                value={metaHash}
                onChange={(e) => setMetaHash(e.target.value)}
                className="bg-background/50"
              />
              <p className="text-xs text-muted-foreground">Link to your machine specs and pricing configuration.</p>
            </div>
            
            <div className="flex items-center space-x-2 py-4">
              <Switch id="stake" />
              <Label htmlFor="stake">Stake CLD for higher trust score (Optional)</Label>
            </div>

            <Button onClick={handleRegister} disabled={isRegistering} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground h-12 text-lg">
              {isRegistering ? "Registering..." : "Register Provider"}
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
                1,250.00
              </span>
              <span className="text-xl text-muted-foreground font-mono">CLD</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button className="bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20 border border-yellow-400/20">
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
              <Label className="text-xs text-muted-foreground">Metadata Hash</Label>
              <div className="text-xs font-mono bg-black/50 p-2 rounded truncate">
                ipfs://QmXyZ...123abc
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full">Update Metadata</Button>
          </CardContent>
        </Card>
      </div>

      {/* Assigned Jobs List */}
      <Card className="border-white/5 bg-card/40">
        <CardHeader>
          <CardTitle>Assigned Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
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
            <TableBody>
              {MOCK_JOBS.slice(0, 1).map((job) => (
                <TableRow key={job.id} className="hover:bg-white/5 border-white/10 transition-colors">
                  <TableCell className="font-mono font-medium text-primary">
                    {job.id}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{job.creator}</TableCell>
                  <TableCell>{job.deposit}</TableCell>
                  <TableCell>{job.spent}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-green-500/50 text-green-400 bg-green-500/10">
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setLocation(`/job/${job.id}`)}>
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
