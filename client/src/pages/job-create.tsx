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
import { motion } from 'framer-motion';
import { 
  Cpu, 
  Database, 
  Globe, 
  Zap, 
  DollarSign, 
  Clock, 
  Server,
  Activity,
  CheckCircle,
  AlertCircle,
  Sparkles,
  TrendingUp,
  Shield,
  ArrowRight
} from 'lucide-react';

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
    description: 'Deploy static websites and web applications globally',
    category: 'Web Services',
    icon: Globe,
    color: 'indigo',
    spec: {
      containerImage: 'nginx:alpine',
      resources: { cpu: 1, memory: '1Gi', storage: '10Gi' },
      ports: [80],
      timeout: 86400,
      payment: '50'
    },
    features: ['Global CDN', 'SSL/TLS', 'DDoS Protection'],
    savings: '75%'
  },
  {
    id: 'nodejs-api',
    name: 'Node.js API',
    description: 'Scalable backend services and REST APIs',
    category: 'Backend Services',
    icon: Server,
    color: 'emerald',
    spec: {
      containerImage: 'node:18-alpine',
      command: ['npm', 'start'],
      resources: { cpu: 2, memory: '2Gi', storage: '5Gi' },
      ports: [3000],
      timeout: 86400,
      payment: '100'
    },
    features: ['Auto-scaling', 'Load Balancing', 'Health Checks'],
    savings: '80%'
  },
  {
    id: 'python-ml',
    name: 'ML Training',
    description: 'GPU-accelerated machine learning workloads',
    category: 'AI/ML',
    icon: Activity,
    color: 'purple',
    spec: {
      containerImage: 'tensorflow/tensorflow:latest-gpu',
      command: ['python', 'train.py'],
      resources: { cpu: 4, memory: '8Gi', storage: '20Gi' },
      timeout: 7200,
      payment: '300'
    },
    features: ['GPU Access', 'Model Versioning', 'Distributed Training'],
    savings: '85%'
  },
  {
    id: 'database',
    name: 'Database',
    description: 'Managed database instances with automatic backups',
    category: 'Data Storage',
    icon: Database,
    color: 'cyan',
    spec: {
      containerImage: 'postgres:15-alpine',
      environment: { POSTGRES_DB: 'myapp', POSTGRES_USER: 'user', POSTGRES_PASSWORD: 'password' },
      resources: { cpu: 2, memory: '4Gi', storage: '50Gi' },
      ports: [5432],
      timeout: 86400,
      payment: '150'
    },
    features: ['Auto Backups', 'Replication', 'Monitoring'],
    savings: '70%'
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
  const [currentStep, setCurrentStep] = useState(0);

  const handleTemplateSelect = (templateId: string) => {
    const template = PRESET_TEMPLATES.find(t => t.id === templateId);
    if (template) {
      setSelectedTemplate(templateId);
      setWorkloadSpec(template.spec);
      if (template.spec.environment) {
        setEnvVars(Object.entries(template.spec.environment).map(([key, value]) => ({ key, value })));
      }
      setCurrentStep(1);
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
    const cpuCost = workloadSpec.resources.cpu * 0.02;
    const memoryGb = parseFloat(workloadSpec.resources.memory.replace(/[^0-9.]/g, ''));
    const memoryCost = memoryGb * 0.001;
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
      const finalSpec = {
        ...workloadSpec,
        environment: envVars.reduce((acc, env) => {
          if (env.key && env.value) {
            acc[env.key] = env.value;
          }
          return acc;
        }, {} as Record<string, string>)
      };

      // Use Akash bridge for deployment
      const response = await fetch('http://localhost:3001/api/jobs/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `job-${Date.now()}`,
          user: address,
          containerImage: finalSpec.containerImage,
          resources: finalSpec.resources,
          environment: finalSpec.environment,
          command: finalSpec.command,
          ports: finalSpec.ports,
          timeout: finalSpec.timeout,
          payment: finalSpec.payment
        })
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: 'Job submitted successfully!',
          description: `Deploying to Akash Network via bridge. Job ID: ${result.data.jobId}`,
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
        setCurrentStep(0);
      } else {
        throw new Error(result.error || 'Submission failed');
      }

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

  const selectedTemplateData = PRESET_TEMPLATES.find(t => t.id === selectedTemplate);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-indigo-900/10 to-gray-900">
      {/* Background Effects */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-indigo-600/5 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 left-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '3s' }} />
      </div>

      <div className="relative container-enterprise section-spacing">
        {/* Header */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 mb-6">
            <Sparkles className="w-4 h-4" />
            <span className="text-sm font-medium">ENTERPRISE COMPUTE DEPLOYMENT</span>
          </div>
          
          <h1 className="text-5xl md:text-6xl font-bold mb-6 bg-gradient-to-r from-white via-gray-200 to-gray-400 bg-clip-text text-transparent" 
              style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Deploy Workloads
          </h1>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            Choose from enterprise-grade templates or configure custom workloads. Deploy to 100+ global providers with 
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400 font-semibold"> 60-85% cost savings</span>.
          </p>
        </motion.div>

        {currentStep === 0 ? (
          /* Template Selection */
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            <Card className="card-glass border-white/10 mb-8">
              <CardHeader className="text-center">
                <CardTitle className="text-2xl text-white">Choose Your Template</CardTitle>
                <CardDescription className="text-gray-400">
                  Select a pre-configured template optimized for the decentralized network
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {PRESET_TEMPLATES.map((template) => {
                    const IconComponent = template.icon;
                    const colorClasses = {
                      indigo: 'from-indigo-500 to-purple-600 border-indigo-500/30',
                      emerald: 'from-emerald-500 to-cyan-600 border-emerald-500/30',
                      purple: 'from-purple-500 to-pink-600 border-purple-500/30',
                      cyan: 'from-cyan-500 to-blue-600 border-cyan-500/30'
                    };

                    return (
                      <motion.div
                        key={template.id}
                        whileHover={{ scale: 1.02, y: -5 }}
                        whileTap={{ scale: 0.98 }}
                        className="card-glass card-hover-lift p-6 cursor-pointer group relative overflow-hidden"
                        onClick={() => handleTemplateSelect(template.id)}
                      >
                        {/* Gradient Overlay */}
                        <div className={`absolute inset-0 bg-gradient-to-br ${colorClasses[template.color as keyof typeof colorClasses]?.replace('border-', '').replace('/30', '/5')} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
                        
                        <div className="relative">
                          {/* Header */}
                          <div className="flex items-start justify-between mb-4">
                            <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${colorClasses[template.color as keyof typeof colorClasses]?.split(' ')[0]} ${colorClasses[template.color as keyof typeof colorClasses]?.split(' ')[1]} flex items-center justify-center group-hover:shadow-lg transition-all duration-300`}>
                              <IconComponent className="h-6 w-6 text-white" />
                            </div>
                            <Badge variant="outline" className="border-gray-600 text-gray-400">
                              {template.category}
                            </Badge>
                          </div>

                          {/* Content */}
                          <h3 className="text-xl font-bold text-white mb-2">{template.name}</h3>
                          <p className="text-gray-400 mb-4 leading-relaxed">{template.description}</p>

                          {/* Features */}
                          <div className="flex flex-wrap gap-2 mb-4">
                            {template.features.map((feature) => (
                              <span key={feature} className="px-2 py-1 bg-white/5 text-xs text-gray-300 rounded border border-white/10">
                                {feature}
                              </span>
                            ))}
                          </div>

                          {/* Footer */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="text-lg font-bold text-white">{template.spec.payment} CLD</div>
                              <Badge variant="outline" className="border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
                                {template.savings} savings
                              </Badge>
                            </div>
                            <ArrowRight className="h-5 w-5 text-gray-400 group-hover:text-white group-hover:translate-x-1 transition-all duration-200" />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ) : (
          /* Configuration Step */
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Configuration Forms */}
            <div className="lg:col-span-2 space-y-6">
              {/* Selected Template Display */}
              {selectedTemplateData && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <Card className="card-gradient border-indigo-500/20">
                    <CardHeader>
                      <div className="flex items-center gap-4">
                        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
                          <selectedTemplateData.icon className="h-6 w-6 text-white" />
                        </div>
                        <div>
                          <CardTitle className="text-white">{selectedTemplateData.name}</CardTitle>
                          <CardDescription className="text-indigo-200">{selectedTemplateData.description}</CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                </motion.div>
              )}

              {/* Container Configuration */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
              >
                <Card className="card-glass">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Server className="h-5 w-5" />
                      Container Configuration
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="containerImage" className="text-gray-300">Container Image</Label>
                      <Input
                        id="containerImage"
                        placeholder="e.g., nginx:alpine, node:18, python:3.9"
                        value={workloadSpec.containerImage}
                        onChange={(e) => updateWorkloadSpec('containerImage', e.target.value)}
                        className="input-enterprise"
                      />
                    </div>

                    <div>
                      <Label htmlFor="command" className="text-gray-300">Command (optional)</Label>
                      <Input
                        id="command"
                        placeholder="e.g., npm start, python app.py"
                        value={workloadSpec.command?.join(' ') || ''}
                        onChange={(e) => updateWorkloadSpec('command', e.target.value.split(' ').filter(Boolean))}
                        className="input-enterprise"
                      />
                    </div>

                    <div>
                      <Label htmlFor="timeout" className="text-gray-300 flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Timeout (seconds)
                      </Label>
                      <Input
                        id="timeout"
                        type="number"
                        value={workloadSpec.timeout}
                        onChange={(e) => updateWorkloadSpec('timeout', parseInt(e.target.value))}
                        className="input-enterprise"
                      />
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Resource Requirements */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
              >
                <Card className="card-glass">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Cpu className="h-5 w-5" />
                      Resource Requirements
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <Label htmlFor="cpu" className="text-gray-300">CPU Cores</Label>
                        <Input
                          id="cpu"
                          type="number"
                          min="0.5"
                          step="0.5"
                          value={workloadSpec.resources.cpu}
                          onChange={(e) => updateResource('cpu', parseFloat(e.target.value))}
                          className="input-enterprise"
                        />
                      </div>

                      <div>
                        <Label htmlFor="memory" className="text-gray-300">Memory</Label>
                        <Input
                          id="memory"
                          placeholder="e.g., 1Gi, 512Mi, 2GB"
                          value={workloadSpec.resources.memory}
                          onChange={(e) => updateResource('memory', e.target.value)}
                          className="input-enterprise"
                        />
                      </div>

                      <div>
                        <Label htmlFor="storage" className="text-gray-300">Storage</Label>
                        <Input
                          id="storage"
                          placeholder="e.g., 10Gi, 1TB"
                          value={workloadSpec.resources.storage}
                          onChange={(e) => updateResource('storage', e.target.value)}
                          className="input-enterprise"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Environment Variables */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Card className="card-glass">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Shield className="h-5 w-5" />
                      Environment Variables
                    </CardTitle>
                    <CardDescription className="text-gray-400">
                      Configure environment variables for your container
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {envVars.map((env, index) => (
                        <div key={index} className="flex gap-3">
                          <Input
                            placeholder="Variable name"
                            value={env.key}
                            onChange={(e) => updateEnvVar(index, 'key', e.target.value)}
                            className="input-enterprise"
                          />
                          <Input
                            placeholder="Value"
                            value={env.value}
                            onChange={(e) => updateEnvVar(index, 'value', e.target.value)}
                            className="input-enterprise"
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeEnvVar(index)}
                            className="btn-ghost-enterprise px-3"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <Button variant="outline" onClick={addEnvVar} className="btn-ghost-enterprise">
                        Add Environment Variable
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            </div>

            {/* Sticky Summary Panel */}
            <div className="space-y-6">
              {/* Cost Summary */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 }}
              >
                <Card className="card-gradient sticky top-8">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <DollarSign className="h-5 w-5" />
                      Cost Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Estimated Cost:</span>
                        <span className="text-gray-200">{estimatedCost} CLD</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Your Payment:</span>
                        <span className="text-white font-semibold">{workloadSpec.payment} CLD</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-300">Platform Fee (2.5%):</span>
                        <span className="text-gray-200">{(parseFloat(workloadSpec.payment) * 0.025).toFixed(2)} CLD</span>
                      </div>
                      <div className="border-t border-gray-600 pt-3">
                        <div className="flex justify-between font-semibold">
                          <span className="text-gray-200">Provider Receives:</span>
                          <span className="text-emerald-400">{(parseFloat(workloadSpec.payment) * 0.975).toFixed(2)} CLD</span>
                        </div>
                      </div>
                    </div>

                    {/* Savings Badge */}
                    {selectedTemplateData && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                        <div className="text-emerald-400 font-bold text-lg">
                          {selectedTemplateData.savings} Savings
                        </div>
                        <div className="text-emerald-300 text-sm">vs traditional cloud</div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>

              {/* Job Summary */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
              >
                <Card className="card-glass">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-white">
                      <Activity className="h-5 w-5" />
                      Deployment Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Image:</span>
                        <span className="font-mono text-gray-200 truncate max-w-[150px]">{workloadSpec.containerImage || 'Not specified'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Resources:</span>
                        <span className="text-gray-200">{workloadSpec.resources.cpu}CPU, {workloadSpec.resources.memory}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Duration:</span>
                        <span className="text-gray-200">{Math.floor(workloadSpec.timeout / 3600)}h {Math.floor((workloadSpec.timeout % 3600) / 60)}m</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-400">Environment:</span>
                        <span className="text-gray-200">{envVars.length} variables</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>

              {/* Action Buttons */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="space-y-3"
              >
                <Button
                  variant="enterprise"
                  size="lg"
                  onClick={submitJob}
                  disabled={!workloadSpec.containerImage || isSubmitting}
                  loading={isSubmitting}
                  className="w-full"
                >
                  {isSubmitting ? 'Deploying...' : `Deploy Job (${workloadSpec.payment} CLD)`}
                </Button>
                
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    setCurrentStep(0);
                    setSelectedTemplate('');
                  }}
                  className="w-full btn-ghost-enterprise"
                >
                  Back to Templates
                </Button>
              </motion.div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}