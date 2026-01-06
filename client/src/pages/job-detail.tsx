import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { AddressDisplay } from "@/components/ui/address-display";
import { TxLink } from "@/components/ui/tx-link";
import { useWallet } from "@/context/wallet-context";
import { MOCK_JOBS, MOCK_LOGS } from "@/lib/mock-data";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, CheckCircle2, Clock, FileCode, Send, ShieldCheck, XCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";

export default function JobDetail() {
  const [match, params] = useRoute("/job/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Mock finding job
  const job = MOCK_JOBS.find(j => j.id === params?.id) || MOCK_JOBS[0];
  const logs = MOCK_LOGS.filter(l => l.jobId === job.id);

  const [usageStep, setUsageStep] = useState(0); // 0: Idle, 1: Requesting, 2: Received Sig, 3: Submitting, 4: Done
  const [grossCost, setGrossCost] = useState("10");
  const [validatorSig, setValidatorSig] = useState<string | null>(null);

  const handleRequestSignature = () => {
    setUsageStep(1);
    // Simulate validator signature request (EIP-712)
    setTimeout(() => {
      setValidatorSig("0x789...signature...abc");
      setUsageStep(2);
      toast({
        title: "Signature Received",
        description: "Validator has authorized this usage report.",
      });
    }, 1500);
  };

  const handleSubmitOnChain = () => {
    setUsageStep(3);
    // Simulate chain tx
    setTimeout(() => {
      setUsageStep(4);
      toast({
        title: "Transaction Confirmed",
        description: "Usage report submitted on-chain successfully.",
      });
    }, 2000);
  };

  const resetFlow = () => {
    setUsageStep(0);
    setValidatorSig(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Button variant="ghost" onClick={() => setLocation("/user")} className="pl-0 hover:pl-2 transition-all">
        <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Top Summary */}
          <Card className="glass-card border-white/10">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div>
                  <CardTitle className="text-2xl font-mono">{job.id}</CardTitle>
                  <CardDescription>Created {new Date(job.createdAt).toLocaleDateString()}</CardDescription>
                </div>
                <Badge variant="outline" className={
                  job.status === 'OPEN' ? 'border-green-500/50 text-green-400 bg-green-500/10 text-sm px-3 py-1' :
                  'border-white/20 text-muted-foreground bg-white/5'
                }>
                  {job.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block mb-2">Creator</span>
                  <AddressDisplay address={job.creator} truncate={true} truncateLength={6} />
                </div>
                <div>
                  <span className="text-muted-foreground block mb-2">Provider</span>
                  <AddressDisplay address={job.providerAddress} truncate={true} truncateLength={6} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Budget Utilization</span>
                  <span className="font-mono">{job.spent} / {job.deposit} CLD</span>
                </div>
                <Progress value={(job.spent / job.deposit) * 100} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{((job.spent / job.deposit) * 100).toFixed(1)}% Spent</span>
                  <span>{job.remaining} CLD Remaining</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Usage Submission Workflow */}
          <Card className="border-primary/20 bg-gradient-to-br from-card to-primary/5 overflow-hidden relative">
             {/* Decorative Background Glow */}
             <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
             
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCode className="h-5 w-5 text-primary" /> Mock Usage Submission
              </CardTitle>
              <CardDescription>Simulate the Provider → Backend → OnChain workflow.</CardDescription>
            </CardHeader>
            <CardContent>
              <AnimatePresence mode="wait">
                {usageStep === 0 && (
                  <motion.div 
                    key="step0"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-4"
                  >
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Gross Cost (CLD)</Label>
                        <Input value={grossCost} onChange={(e) => setGrossCost(e.target.value)} className="bg-background/50" />
                      </div>
                      <div className="space-y-2">
                        <Label>User Refund (Optional)</Label>
                        <Input placeholder="0" className="bg-background/50" />
                      </div>
                    </div>
                    <Button onClick={handleRequestSignature} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground">
                      <Send className="mr-2 h-4 w-4" />
                      Request Signature from Backend
                    </Button>
                  </motion.div>
                )}

                {usageStep === 1 && (
                  <motion.div 
                    key="step1"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="flex flex-col items-center justify-center py-8 space-y-4"
                  >
                    <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                    <p className="text-muted-foreground">Verifying usage with Backend Node...</p>
                  </motion.div>
                )}

                {usageStep === 2 && (
                  <motion.div 
                    key="step2"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-4"
                  >
                     <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg flex items-start gap-3">
                        <CheckCircle2 className="h-5 w-5 text-green-500 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-green-500">Signature Received</h4>
                          <p className="text-sm text-green-400/80 mt-1">Validator has verified the usage logs and authorized this deduction (EIP-712).</p>
                          <div className="mt-2 text-xs font-mono bg-black/40 p-2 rounded break-all text-muted-foreground">
                            {validatorSig}
                          </div>
                        </div>
                     </div>
                     <Button onClick={handleSubmitOnChain} className="w-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-[0_0_20px_rgba(6,182,212,0.3)]">
                       <Send className="mr-2 h-4 w-4" /> Submit Transaction On-Chain
                     </Button>
                  </motion.div>
                )}

                 {usageStep === 3 && (
                  <motion.div 
                    key="step3"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center justify-center py-8 space-y-4"
                  >
                    <Loader2 className="h-12 w-12 text-yellow-400 animate-spin" />
                    <p className="text-muted-foreground">Waiting for block confirmation...</p>
                  </motion.div>
                )}

                {usageStep === 4 && (
                   <motion.div 
                    key="step4"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center py-4 space-y-6"
                  >
                    <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center">
                      <ShieldCheck className="w-8 h-8 text-green-500" />
                    </div>
                    <div className="text-center space-y-1">
                      <h3 className="text-2xl font-bold">Usage Confirmed</h3>
                      <p className="text-muted-foreground">Job balance has been updated on-chain.</p>
                    </div>
                    <Button variant="outline" onClick={resetFlow}>Submit Another Usage</Button>
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>

        {/* Timeline Column */}
        <div className="space-y-6">
          <Card className="h-full border-white/5 bg-card/40">
            <CardHeader>
              <CardTitle className="text-lg">Event History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative border-l border-white/10 ml-3 space-y-8 pb-4">
                {logs.map((log, i) => (
                  <div key={i} className="pl-6 relative">
                    <div className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-background" />
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-medium">{log.event}</span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      {log.amount && (
                        <span className="text-xs font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded w-fit mt-1">
                          -{log.amount} CLD
                        </span>
                      )}
                      {log.tx && (
                        <TxLink hash={log.tx as `0x${string}`} variant="inline" className="mt-1" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
            <CardFooter>
               <Button variant="destructive" className="w-full bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/50">Close Job & Refund</Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
