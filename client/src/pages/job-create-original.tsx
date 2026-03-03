import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAccount } from 'wagmi';
import { uploadToIPFS } from '@/lib/api';
import { useWorkloadRegistry, useCLDToken } from '@/lib/contracts';

interface WorkloadSpec {
  containerImage: string;
  command?: string[];
  environment?: Record<string, string>;
  resources: {
    cpu: number;
    memory: string;
    storage: string;
  };
  ports?: number[];
  timeout: number;
  payment: string;
}

const PRESET_TEMPLATES = [
  {
    id: 'web-hosting',
    name: 'Web Hosting',
    description: 'Host a static website or web application',
    spec: {
      containerImage: 'nginx:alpine',
      resources: { cpu: 1, memory: '1Gi', storage: '10Gi' },
      ports: [80],
      timeout: 86400, // 24 hours
      payment: '100'
    }
  },
  {
    id: 'nodejs-api',
    name: 'Node.js API',
    description: 'Run a Node.js backend API service',
    spec: {
      containerImage: 'node:18-alpine',
      command: ['npm', 'start'],
      resources: { cpu: 2, memory: '2Gi', storage: '5Gi' },
      ports: [3000],
      timeout: 86400,
      payment: '200'
    }
  },
  {
    id: 'python-ml',
    name: 'Python ML Training',
    description: 'Machine learning model training with Python',
    spec: {
      containerImage: 'python:3.9-slim',
      command: ['python', 'train.py'],
      resources: { cpu: 4, memory: '8Gi', storage: '20Gi' },
      timeout: 7200, // 2 hours
      payment: '500'
    }
  },
  {
    id: 'database',
    name: 'PostgreSQL Database',
    description: 'Managed PostgreSQL database instance',
    spec: {
      containerImage: 'postgres:15-alpine',
      environment: { POSTGRES_DB: 'myapp', POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'password' },
      resources: { cpu: 2, memory: '4Gi', storage: '50Gi' },
      ports: [5432],
      timeout: 86400,
      payment: '300'
    }
  }
];

export default function JobCreate() {
  const { address } = useAccount();
  const { toast } = useToast();
  const workloadRegistry = useWorkloadRegistry();
  const cldToken = useCLDToken();

  const [selectedTemplate, setSelectedTemplate] = useState<string>('');
  const [workloadSpec, setWorkloadSpec] = useState<WorkloadSpec>({
    containerImage: '',
    resources: { cpu: 1, memory: '1Gi', storage: '5Gi' },
    timeout: 3600,
    payment: '100'
  });
  const [envVars, setEnvVars] = useState<Array<{key: string, value: string}>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [estimatedCost, setEstimatedCost] = useState<string>('0');

  const handleTemplateSelect = (templateId: string) => {
    const template = PRESET_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setWorkloadSpec(template.spec);
      if (template.spec.environment) {
        setEnvVars(Object.entries(template.spec.environment).map(([key, value]) => ({ key, value })));
      }
    }
  };

  const updateWorkloadSpec = (field: keyof WorkloadSpec, value: any) => {
    setWorkloadSpec(prev => ({ ...prev, [field]: value }));
    calculateEstimatedCost();
  };

  const updateResource = (field: string, value: any) => {
    setWorkloadSpec(prev => ({
      ...prev,
      resources: { ...prev.resources, [field]: value }
    }));
    calculateEstimatedCost();
  };

  const addEnvVar = () => {
    setEnvVars(prev => [...prev, { key: '', value: '' }]);
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    setEnvVars(prev => prev.map((env, i) => 
      i === index ? { ...env, [field]: value } : env
    ));
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(prev => prev.filter((_, i) => i !== index));
  };

  const calculateEstimatedCost = () => {
    // Simple cost estimation based on resources and time
    const cpuCost = workloadSpec.resources.cpu * 0.05; // 0.05 CLD per CPU hour
    const memoryGb = parseFloat(workloadSpec.resources.memory.replace(/[^0-9.]/g, ''));
    const memoryCost = memoryGb * 0.01; // 0.01 CLD per GB hour
    const hourlyRate = cpuCost + memoryCost;
    const hours = workloadSpec.timeout / 3600;
    const totalCost = (hourlyRate * hours).toFixed(2);
    setEstimatedCost(totalCost);
  };

  const submitJob = async () => {
    if (!address || !workloadRegistry || !cldToken) {
      toast({
        title: 'Wallet not connected',
        description: 'Please connect your wallet to submit a job',
        variant: 'destructive'
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Prepare final workload specification
      const finalSpec = {
        ...workloadSpec,
        environment: envVars.reduce((acc, env) => {
          if (env.key && env.value) {
            acc[env.key] = env.value;
          }
          return acc;
        }, {} as Record<string, string>)
      };

      // Upload specification to IPFS
      toast({ title: 'Uploading job specification...', description: 'Storing job details on IPFS' });
      const ipfsHash = await uploadToIPFS(finalSpec);

      // Check CLD allowance and approve if needed
      const paymentWei = ethers.utils.parseUnits(workloadSpec.payment, 18);
      const allowance = await cldToken.read.allowance([address, workloadRegistry.address]);
      
      if (allowance < paymentWei) {
        toast({ title: 'Approving CLD tokens...', description: 'Please confirm the approval transaction' });
        const approveTx = await cldToken.write.approve([workloadRegistry.address, paymentWei]);
        await approveTx.wait();
      }

      // Submit job to registry
      toast({ title: 'Creating workload...', description: 'Submitting job to the network' });
      const createTx = await workloadRegistry.write.createWorkload([`0x${ipfsHash}`, paymentWei]);
      const receipt = await createTx.wait();

      // Extract job ID from event logs
      const jobId = receipt.logs.find(log => log.topics[0] === workloadRegistry.interface.getEventTopic('WorkloadCreated'))?.topics[1];

      toast({
        title: 'Job submitted successfully!',
        description: `Job ID: ${jobId}. Providers will start processing your workload.`,
      });

      // Reset form
      setWorkloadSpec({
        containerImage: '',
        resources: { cpu: 1, memory: '1Gi', storage: '5Gi' },
        timeout: 3600,
        payment: '100'
      });
      setEnvVars([]);
      setSelectedTemplate('');

    } catch (error) {
      console.error('Job submission error:', error);
      toast({
        title: 'Job submission failed',
        description: error.message || 'An unexpected error occurred',
        variant: 'destructive'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold">Create Compute Job</h1>
        <p className="text-gray-600 mt-2">Deploy your containerized workload on the Cloudana network</p>
      </div>

      {/* Template Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Choose a Template</CardTitle>
          <CardDescription>Select a pre-configured template or start from scratch</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PRESET_TEMPLATES.map((template) => (
              <div
                key={template.id}
                className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                  selectedTemplate === template.id 
                    ? 'border-blue-500 bg-blue-50' 
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => handleTemplateSelect(template.id)}
              >
                <h3 className="font-semibold">{template.name}</h3>
                <p className="text-sm text-gray-600 mt-1">{template.description}</p>
                <div className="flex gap-2 mt-2">
                  <Badge variant="secondary">{template.spec.payment} CLD</Badge>
                  <Badge variant="outline">{template.spec.resources.cpu} CPU</Badge>
                  <Badge variant="outline">{template.spec.resources.memory}</Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Job Configuration */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          {/* Container Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Container Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="containerImage">Container Image</Label>
                <Input
                  id="containerImage"
                  placeholder="e.g., nginx:alpine, node:18, python:3.9"
                  value={workloadSpec.containerImage}
                  onChange={(e) => updateWorkloadSpec('containerImage', e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="command">Command (optional)</Label>
                <Input
                  id="command"
                  placeholder="e.g., npm start, python app.py"
                  value={workloadSpec.command?.join(' ') || ''}
                  onChange={(e) => updateWorkloadSpec('command', e.target.value.split(' ').filter(Boolean))}
                />
              </div>

              <div>
                <Label htmlFor="timeout">Timeout (seconds)</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={workloadSpec.timeout}
                  onChange={(e) => updateWorkloadSpec('timeout', parseInt(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Resource Requirements */}
          <Card>
            <CardHeader>
              <CardTitle>Resource Requirements</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="cpu">CPU Cores</Label>
                <Input
                  id="cpu"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={workloadSpec.resources.cpu}
                  onChange={(e) => updateResource('cpu', parseFloat(e.target.value))}
                />
              </div>

              <div>
                <Label htmlFor="memory">Memory</Label>
                <Input
                  id="memory"
                  placeholder="e.g., 1Gi, 512Mi, 2GB"
                  value={workloadSpec.resources.memory}
                  onChange={(e) => updateResource('memory', e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="storage">Storage</Label>
                <Input
                  id="storage"
                  placeholder="e.g., 10Gi, 1TB"
                  value={workloadSpec.resources.storage}
                  onChange={(e) => updateResource('storage', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Environment Variables */}
          <Card>
            <CardHeader>
              <CardTitle>Environment Variables</CardTitle>
              <CardDescription>Configure environment variables for your container</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {envVars.map((env, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      placeholder="Variable name"
                      value={env.key}
                      onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                    />
                    <Input
                      placeholder="Value"
                      value={env.value}
                      onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeEnvVar(index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button variant="outline" onClick={addEnvVar}>
                  Add Environment Variable
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Payment and Summary */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Payment Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="payment">Payment Amount (CLD)</Label>
                <Input
                  id="payment"
                  type="number"
                  value={workloadSpec.payment}
                  onChange={(e) => updateWorkloadSpec('payment', e.target.value)}
                />
              </div>

              <div className="p-4 bg-gray-50 rounded-lg">
                <h4 className="font-semibold mb-2">Cost Breakdown</h4>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Estimated Cost:</span>
                    <span>{estimatedCost} CLD</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Your Payment:</span>
                    <span>{workloadSpec.payment} CLD</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Platform Fee (2.5%):</span>
                    <span>{(parseFloat(workloadSpec.payment) * 0.025).toFixed(2)} CLD</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Provider Receives:</span>
                    <span>{(parseFloat(workloadSpec.payment) * 0.975).toFixed(2)} CLD</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Job Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Job Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span>Image:</span>
                <span className="text-sm font-mono">{workloadSpec.containerImage || 'Not specified'}</span>
              </div>
              <div className="flex justify-between">
                <span>Resources:</span>
                <span className="text-sm">{workloadSpec.resources.cpu}CPU, {workloadSpec.resources.memory}, {workloadSpec.resources.storage}</span>
              </div>
              <div className="flex justify-between">
                <span>Duration:</span>
                <span className="text-sm">{Math.floor(workloadSpec.timeout / 3600)}h {Math.floor((workloadSpec.timeout % 3600) / 60)}m</span>
              </div>
              <div className="flex justify-between">
                <span>Environment:</span>
                <span className="text-sm">{envVars.length} variables</span>
              </div>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <Button
            className="w-full"
            size="lg"
            onClick={submitJob}
            disabled={!workloadSpec.containerImage || isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : `Submit Job (${workloadSpec.payment} CLD)`}
          </Button>
        </div>
      </div>
    </div>
  );
}