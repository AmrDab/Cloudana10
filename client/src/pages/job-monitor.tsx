import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccount } from 'wagmi';
import { useWorkloadRegistry } from '@/lib/contracts';
import { downloadFromIPFS } from '@/lib/api';
import { Clock, CheckCircle, XCircle, PlayCircle, Search, ExternalLink } from 'lucide-react';

interface Job {
  id: string;
  user: string;
  specHash: string;
  payment: string;
  status: number;
  resultHash: string;
  createdAt: number;
  spec?: any;
  results?: any;
}

const JOB_STATUS = {
  0: { label: 'Pending', color: 'bg-yellow-500', icon: Clock },
  1: { label: 'Running', color: 'bg-blue-500', icon: PlayCircle },
  2: { label: 'Complete', color: 'bg-green-500', icon: CheckCircle },
  3: { label: 'Failed', color: 'bg-red-500', icon: XCircle }
};

export default function JobMonitor() {
  const { address } = useAccount();
  const workloadRegistry = useWorkloadRegistry();
  
  const [jobs, setJobs] = useState<Job[]>([]);
  const [filteredJobs, setFilteredJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  useEffect(() => {
    if (address && workloadRegistry) {
      loadJobs();
    }
  }, [address, workloadRegistry]);

  useEffect(() => {
    filterJobs();
  }, [jobs, searchQuery, statusFilter]);

  const loadJobs = async () => {
    setLoading(true);
    try {
      // Get total job count
      const jobCount = await workloadRegistry.read.getJobCount();
      const jobList: Job[] = [];

      // Load all jobs (in production, implement pagination)
      for (let i = 0; i < Math.min(jobCount, 100); i++) {
        try {
          const jobData = await workloadRegistry.read.getJob([i]);
          
          // Only include jobs from current user or make it configurable
          jobList.push({
            id: i.toString(),
            user: jobData.user,
            specHash: jobData.specHash,
            payment: jobData.payment.toString(),
            status: jobData.status,
            resultHash: jobData.resultHash,
            createdAt: Date.now() - (i * 3600000), // Mock timestamp, should come from events
          });
        } catch (error) {
          console.error(`Error loading job ${i}:`, error);
        }
      }

      // Filter to show user's jobs by default, or all jobs if viewing as provider
      const userJobs = jobList.filter(job => job.user.toLowerCase() === address?.toLowerCase());
      setJobs(userJobs);

    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filterJobs = () => {
    let filtered = jobs;

    // Status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(job => job.status === parseInt(statusFilter));
    }

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(job =>
        job.id.includes(searchQuery) ||
        job.specHash.includes(searchQuery) ||
        job.user.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    setFilteredJobs(filtered);
  };

  const loadJobDetails = async (job: Job) => {
    setSelectedJob(job);
    setLoadingDetails(true);

    try {
      // Load job specification from IPFS
      if (job.specHash && !job.spec) {
        const specHash = job.specHash.replace('0x', '');
        const spec = await downloadFromIPFS(specHash);
        job.spec = spec;
      }

      // Load results from IPFS if completed
      if (job.status === 2 && job.resultHash && !job.results) {
        try {
          const results = await downloadFromIPFS(job.resultHash);
          job.results = results;
        } catch (error) {
          console.error('Error loading job results:', error);
        }
      }

      setSelectedJob({ ...job });
    } catch (error) {
      console.error('Error loading job details:', error);
    } finally {
      setLoadingDetails(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const formatPayment = (paymentWei: string) => {
    return (parseFloat(paymentWei) / 1e18).toFixed(2);
  };

  const getStatusBadge = (status: number) => {
    const statusInfo = JOB_STATUS[status as keyof typeof JOB_STATUS];
    const Icon = statusInfo.icon;
    
    return (
      <Badge className={`${statusInfo.color} text-white`}>
        <Icon className="w-3 h-3 mr-1" />
        {statusInfo.label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="text-center">
          <h1 className="text-3xl font-bold mb-4">Job Monitor</h1>
          <p>Loading your jobs...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold">Job Monitor</h1>
        <p className="text-gray-600 mt-2">Track your compute jobs on the Cloudana network</p>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label htmlFor="search">Search Jobs</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  id="search"
                  placeholder="Search by job ID, user address, or spec hash..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            
            <div>
              <Label htmlFor="status">Filter by Status</Label>
              <select
                id="status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="all">All Statuses</option>
                <option value="0">Pending</option>
                <option value="1">Running</option>
                <option value="2">Complete</option>
                <option value="3">Failed</option>
              </select>
            </div>

            <Button onClick={loadJobs} variant="outline">
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Jobs List */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Your Jobs ({filteredJobs.length})</CardTitle>
              <CardDescription>Click on a job to view details</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {filteredJobs.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    {jobs.length === 0 ? 'No jobs found' : 'No jobs match your filters'}
                  </div>
                ) : (
                  filteredJobs.map((job) => (
                    <div
                      key={job.id}
                      className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                        selectedJob?.id === job.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'hover:border-gray-300'
                      }`}
                      onClick={() => loadJobDetails(job)}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className="font-semibold">Job #{job.id}</h3>
                          <p className="text-sm text-gray-600">
                            Created: {formatDate(job.createdAt)}
                          </p>
                        </div>
                        {getStatusBadge(job.status)}
                      </div>
                      
                      <div className="flex justify-between items-center text-sm">
                        <span className="font-mono text-gray-500">
                          {job.specHash.slice(0, 10)}...{job.specHash.slice(-8)}
                        </span>
                        <span className="font-semibold">
                          {formatPayment(job.payment)} CLD
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Job Details */}
        <div>
          <Card className="sticky top-8">
            <CardHeader>
              <CardTitle>Job Details</CardTitle>
              <CardDescription>
                {selectedJob ? `Job #${selectedJob.id}` : 'Select a job to view details'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedJob ? (
                <div className="text-center py-8 text-gray-500">
                  Select a job from the list to see detailed information
                </div>
              ) : loadingDetails ? (
                <div className="text-center py-8">Loading details...</div>
              ) : (
                <Tabs defaultValue="overview" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="spec">Spec</TabsTrigger>
                    <TabsTrigger value="results">Results</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="overview" className="space-y-4 mt-4">
                    <div className="space-y-3">
                      <div>
                        <Label>Status</Label>
                        <div className="mt-1">{getStatusBadge(selectedJob.status)}</div>
                      </div>
                      
                      <div>
                        <Label>Payment</Label>
                        <p className="text-lg font-semibold">{formatPayment(selectedJob.payment)} CLD</p>
                      </div>
                      
                      <div>
                        <Label>User Address</Label>
                        <p className="font-mono text-sm break-all">{selectedJob.user}</p>
                      </div>
                      
                      <div>
                        <Label>Spec Hash</Label>
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-sm break-all flex-1">{selectedJob.specHash}</p>
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => window.open(`https://ipfs.io/ipfs/${selectedJob.specHash.replace('0x', '')}`, '_blank')}
                          >
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                      
                      {selectedJob.resultHash && (
                        <div>
                          <Label>Result Hash</Label>
                          <div className="flex items-center gap-2">
                            <p className="font-mono text-sm break-all flex-1">{selectedJob.resultHash}</p>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => window.open(`https://ipfs.io/ipfs/${selectedJob.resultHash}`, '_blank')}
                            >
                              <ExternalLink className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="spec" className="mt-4">
                    {selectedJob.spec ? (
                      <div className="space-y-3">
                        <div>
                          <Label>Container Image</Label>
                          <p className="font-mono">{selectedJob.spec.containerImage}</p>
                        </div>
                        
                        {selectedJob.spec.command && (
                          <div>
                            <Label>Command</Label>
                            <p className="font-mono text-sm">{selectedJob.spec.command.join(' ')}</p>
                          </div>
                        )}
                        
                        <div>
                          <Label>Resources</Label>
                          <div className="text-sm space-y-1">
                            <p>CPU: {selectedJob.spec.resources.cpu} cores</p>
                            <p>Memory: {selectedJob.spec.resources.memory}</p>
                            <p>Storage: {selectedJob.spec.resources.storage}</p>
                          </div>
                        </div>
                        
                        <div>
                          <Label>Timeout</Label>
                          <p>{Math.floor(selectedJob.spec.timeout / 3600)}h {Math.floor((selectedJob.spec.timeout % 3600) / 60)}m</p>
                        </div>
                        
                        {selectedJob.spec.environment && Object.keys(selectedJob.spec.environment).length > 0 && (
                          <div>
                            <Label>Environment Variables</Label>
                            <div className="text-sm font-mono space-y-1">
                              {Object.entries(selectedJob.spec.environment).map(([key, value]) => (
                                <p key={key}>{key}={value as string}</p>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-500">Loading specification...</p>
                    )}
                  </TabsContent>
                  
                  <TabsContent value="results" className="mt-4">
                    {selectedJob.status !== 2 ? (
                      <p className="text-gray-500">Results will be available when the job completes</p>
                    ) : selectedJob.results ? (
                      <div className="space-y-3">
                        <div>
                          <Label>Execution Status</Label>
                          <p className="text-green-600 font-semibold">Completed Successfully</p>
                        </div>
                        
                        {selectedJob.results.logs && (
                          <div>
                            <Label>Execution Logs</Label>
                            <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto max-h-40">
                              {selectedJob.results.logs}
                            </pre>
                          </div>
                        )}
                        
                        {selectedJob.results.files && (
                          <div>
                            <Label>Output Files</Label>
                            <div className="space-y-2">
                              {Object.entries(selectedJob.results.files).map(([filename, content]) => (
                                <div key={filename} className="border rounded p-2">
                                  <p className="font-semibold text-sm">{filename}</p>
                                  <pre className="text-xs text-gray-600 mt-1 max-h-20 overflow-auto">
                                    {typeof content === 'string' ? content.slice(0, 500) : JSON.stringify(content, null, 2).slice(0, 500)}
                                    {(typeof content === 'string' ? content.length : JSON.stringify(content).length) > 500 && '...'}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-gray-500">Loading results...</p>
                    )}
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}