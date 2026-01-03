import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "@/context/wallet-context";
import { getActiveProviders, getUserJobs, createJob, getUserCredits } from "@/lib/api";
import { useLocation } from "wouter";
import { Plus, ExternalLink, RefreshCw, Wallet as WalletIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

export default function UserDashboard() {
  const { isConnected, userAddress } = useWallet();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [selectedProvider, setSelectedProvider] = useState("");
  const [budget, setBudget] = useState("");

  const { data: providers = [], isLoading: providersLoading } = useQuery({
    queryKey: ["activeProviders"],
    queryFn: getActiveProviders,
    enabled: isConnected,
  });

  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["userJobs", userAddress],
    queryFn: () => getUserJobs(userAddress),
    enabled: isConnected,
  });

  const { data: credits } = useQuery({
    queryKey: ["userCredits", userAddress],
    queryFn: () => getUserCredits(userAddress),
    enabled: isConnected,
  });

  const createJobMutation = useMutation({
    mutationFn: (data: { creator: string; providerId: string; deposit: string }) => createJob(data),
    onSuccess: (newJob) => {
      queryClient.invalidateQueries({ queryKey: ["userJobs"] });
      toast({
        title: "Job Created Successfully",
        description: `Job ${newJob.jobNumber} has been created and funded.`,
      });
      setSelectedProvider("");
      setBudget("");
      setLocation(`/job/${newJob.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Create Job",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-[50vh]">
        <h2 className="text-2xl font-bold mb-4">Access Restricted</h2>
        <p className="text-muted-foreground mb-4">Please connect your wallet to view your dashboard.</p>
      </div>
    );
  }

  const handleCreateJob = () => {
    if (!selectedProvider || !budget) {
      toast({
        title: "Validation Error",
        description: "Please select a provider and enter a budget.",
        variant: "destructive"
      });
      return;
    }

    createJobMutation.mutate({
      creator: userAddress,
      providerId: selectedProvider,
      deposit: budget,
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">User Dashboard</h1>
          <p className="text-muted-foreground">Manage your compute jobs and budgets.</p>
        </div>
        <div className="flex gap-4">
           {/* Summary Stats could go here */}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Job Card */}
        <Card className="lg:col-span-2 glass-card border-primary/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" /> Create New Job
            </CardTitle>
            <CardDescription>Provision compute resources by depositing CLD tokens.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="provider">Select Provider</Label>
                <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                  <SelectTrigger id="provider" className="bg-background/50 border-white/10">
                    <SelectValue placeholder="Choose a provider..." />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} ({parseFloat(p.pricing).toFixed(2)} CLD/hr)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="budget">Budget (CLD)</Label>
                <div className="relative">
                  <Input 
                    id="budget" 
                    placeholder="e.g. 100" 
                    type="number" 
                    className="bg-background/50 border-white/10 pr-12"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                  />
                  <span className="absolute right-3 top-2.5 text-xs text-muted-foreground font-mono">CLD</span>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="flex justify-between border-t border-white/5 pt-6">
            <div className="text-sm text-muted-foreground">
              Balance: <span className="font-mono text-foreground">15,000 CLD</span>
            </div>
            <Button 
              onClick={handleCreateJob} 
              disabled={createJobMutation.isPending || providersLoading} 
              className="bg-primary hover:bg-primary/90 text-primary-foreground min-w-[160px]"
            >
              {createJobMutation.isPending ? (
                <>
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Processing...
                </>
              ) : (
                "Create Job + Deposit"
              )}
            </Button>
          </CardFooter>
        </Card>

        {/* Refund Credits Card */}
        <Card className="bg-card/50 border-white/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WalletIcon className="h-5 w-5 text-green-400" /> Refund Credits
            </CardTitle>
            <CardDescription>Unused budget from closed jobs.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-6">
              <span className="text-5xl font-bold font-mono tracking-tighter text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.3)]">
                {credits ? parseFloat(credits.refundBalance).toFixed(2) : "0.00"}
              </span>
              <span className="text-sm text-muted-foreground mt-2">Available to Withdraw</span>
            </div>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full border-green-500/20 text-green-400 hover:bg-green-500/10 hover:text-green-300">
              Withdraw Refund
            </Button>
          </CardFooter>
        </Card>
      </div>

      {/* Jobs List */}
      <Card className="border-white/5 bg-card/40">
        <CardHeader>
          <CardTitle>My Jobs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-white/5 border-white/10">
                <TableHead>Job ID</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Deposited</TableHead>
                <TableHead>Spent</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsLoading ? (
                Array.from({ length: 2 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                  </TableRow>
                ))
              ) : jobs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    No jobs yet. Create your first job to get started.
                  </TableCell>
                </TableRow>
              ) : jobs.map((job) => (
                <TableRow key={job.id} className="hover:bg-white/5 border-white/10 transition-colors">
                  <TableCell className="font-mono font-medium text-primary">
                    <span className="cursor-pointer hover:underline" onClick={() => setLocation(`/job/${job.id}`)}>
                      {job.jobNumber}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-xs">{job.providerId.slice(0, 8)}...</TableCell>
                  <TableCell>{parseFloat(job.deposit).toFixed(2)}</TableCell>
                  <TableCell>{parseFloat(job.spent).toFixed(2)}</TableCell>
                  <TableCell>{parseFloat(job.remaining).toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={
                      job.status === 'OPEN' ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                      job.status === 'CLOSED' ? 'border-white/20 text-muted-foreground bg-white/5' :
                      'border-red-500/50 text-red-400 bg-red-500/10'
                    }>
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => setLocation(`/job/${job.id}`)}>
                      View <ExternalLink className="ml-2 h-3 w-3" />
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
