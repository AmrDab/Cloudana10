import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Database, Globe } from "lucide-react";
import { useState } from "react";

export default function DebugPanel() {
  const [lastSync, setLastSync] = useState(new Date().toLocaleTimeString());

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-mono">System Status</h1>
        <p className="text-muted-foreground">Network configuration and contract addresses.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-white/10 bg-card/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-400" /> Network Info
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 font-mono text-sm">
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-muted-foreground">Chain ID</span>
              <span>84532 (Base Sepolia)</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-muted-foreground">RPC Endpoint</span>
              <span className="truncate max-w-[200px]">https://sepolia.base.org</span>
            </div>
            <div className="flex justify-between py-2 border-b border-white/5">
              <span className="text-muted-foreground">Block Height</span>
              <span>12,450,231</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/40">
          <CardHeader>
             <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-purple-400" /> Contract Addresses
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 font-mono text-sm">
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Cloudana Token (CLD)</span>
              <div className="bg-black/30 p-2 rounded text-xs select-all">0x71C95911E9a5D330f4D621842EC243EE13432921</div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Provider Registry</span>
              <div className="bg-black/30 p-2 rounded text-xs select-all">0x82D39511E9a5D330f4D621842EC243EE13433B44</div>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">Job Escrow</span>
              <div className="bg-black/30 p-2 rounded text-xs select-all">0x93E39511E9a5D330f4D621842EC243EE13435C67</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-card/40">
        <CardHeader>
          <CardTitle>Debug Actions</CardTitle>
          <CardDescription>Tools for integration testing.</CardDescription>
        </CardHeader>
        <CardContent>
           <div className="flex gap-4">
             <Button variant="outline" onClick={() => setLastSync(new Date().toLocaleTimeString())}>
               <RefreshCw className="mr-2 h-4 w-4" /> Re-sync Events
             </Button>
             <Button variant="outline">Clear Local Cache</Button>
           </div>
           <div className="mt-4 text-xs text-muted-foreground">
             Last synced: {lastSync}
           </div>
        </CardContent>
      </Card>
    </div>
  );
}
