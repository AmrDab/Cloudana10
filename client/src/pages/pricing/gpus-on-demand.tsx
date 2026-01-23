import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { CheckCircle2, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const formSchema = z.object({
  firstname: z.string().min(1, "First name is required"),
  lastname: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email").min(1, "Email is required"),
  company: z.string().min(1, "Company name is required"),
  website: z.string().optional(),
  project_details: z.string().min(10, "Please provide at least 10 characters about your project"),
  lead_type: z.string().min(1, "Please select an option"),
  current_amount_spent_on_computer: z.string().optional().nullable(),
  provider_gpu_type: z.array(z.string()).optional().nullable(),
  gpu_quantity_available: z.string().optional().nullable(),
  support_request_info: z.string().optional(),
  phone: z.string().optional(),
}).refine(
  (data) => {
    if (data.lead_type === "Provide GPUs") {
      return data.provider_gpu_type && data.provider_gpu_type.length > 0;
    }
    return true;
  },
  {
    message: "Please select at least one GPU type",
    path: ["provider_gpu_type"],
  },
).refine(
  (data) => {
    if (data.lead_type === "Provide GPUs") {
      return data.gpu_quantity_available && data.gpu_quantity_available.trim() !== "";
    }
    return true;
  },
  {
    message: "Please select GPU quantity",
    path: ["gpu_quantity_available"],
  },
).refine(
  (data) => {
    if (data.lead_type === "Get technical support") {
      return data.support_request_info && data.support_request_info.trim() !== "";
    }
    return true;
  },
  {
    message: "Please describe your support request",
    path: ["support_request_info"],
  },
);

const whyChooseCards = [
  {
    title: "Significant Cost Savings",
    description: "Reduce your cloud computing costs by up to 80% compared to traditional providers.",
  },
  {
    title: "Enhanced Security",
    description: "Benefit from blockchain-secured infrastructure, ensuring data integrity and privacy.",
  },
  {
    title: "Ready to Deploy",
    description: "Deploy your applications globally with ease, leveraging a decentralized network.",
  },
  {
    title: "Decentralized Infrastructure",
    description: "Experience censorship-resistant and permissionless cloud services.",
  },
  {
    title: "Optimized for AI/ML",
    description: "Ideal for AI/ML workloads, offering scalable GPU resources at competitive prices.",
  },
  {
    title: "Community Exposure",
    description: "Join a vibrant AI community where standout projects are spotlighted across the ecosystem.",
  },
];

const readyToDeployStats = [
  { title: "85%", description: "Average Cost Savings" },
  { title: "50+", description: "Provider Locations" },
  { title: "2min", description: "Deployment Speed" },
  { title: "99%", description: "Customer Satisfaction" },
];

export default function GpusOnDemandPage() {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      firstname: "",
      lastname: "",
      email: "",
      company: "",
      website: "",
      project_details: "",
      lead_type: "",
      current_amount_spent_on_computer: null,
      provider_gpu_type: [],
      gpu_quantity_available: null,
      support_request_info: "",
      phone: "",
    },
  });

  const watchedUseCases = form.watch("lead_type");

  const handleNextStep = () => {
    const currentValues = form.getValues();
    const requiredFields = ["lead_type"];
    
    if (currentValues.lead_type === "Rent GPUs") {
      requiredFields.push("firstname", "lastname", "email", "company", "current_amount_spent_on_computer");
    } else {
      requiredFields.push("firstname", "lastname", "email", "company");
    }

    const hasErrors = requiredFields.some((field) => {
      const value = currentValues[field as keyof typeof currentValues];
      return !value || value === "";
    });

    if (!hasErrors) {
      setCurrentStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      form.trigger(requiredFields as any);
    }
  };

  async function onSubmit(values: z.infer<typeof formSchema>) {
    try {
      setIsSubmitting(true);
      
      // Here you would submit to your backend/API
      // For now, we'll just show success
      console.log("Form submitted:", values);
      
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1000));
      
      setShowSuccessDialog(true);
      form.reset();
      setCurrentStep(1);
    } catch (error) {
      console.error("Form submission error:", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="container mx-auto flex min-h-screen flex-col gap-12 pt-8 lg:grid lg:grid-cols-2 lg:gap-20 2xl:gap-16 2xl:pt-14">
      <div className="flex flex-col gap-8">
        <Link href="/pricing/gpus">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to GPU Pricing
          </Button>
        </Link>

        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-semibold leading-[1.3] 2xl:text-5xl 2xl:leading-[1.2]">
            Get Access to GPUs<br /> On Demand
          </h1>
          <p className="text-muted-foreground 2xl:text-lg">
            Need affordable, high-performance GPU compute? From training models to
            running inference or deploying containerized apps, Cloudana OS covers all
            your compute needs.
          </p>
          <p className="text-muted-foreground 2xl:text-lg">
            This quick form helps us understand your needs so we can help you get
            started.
          </p>
        </div>

        {/* Mobile Form */}
        <div className="flex w-full lg:hidden">
          <GpuContactForm
            form={form}
            currentStep={currentStep}
            setCurrentStep={setCurrentStep}
            watchedUseCases={watchedUseCases}
            handleNextStep={handleNextStep}
            onSubmit={onSubmit}
            isSubmitting={isSubmitting}
          />
        </div>

        <div className="flex flex-col gap-4 2xl:gap-6">
          <h2 className="text-2xl font-semibold 2xl:text-3xl">Why Choose Cloudana OS?</h2>
          <div className="grid gap-3 md:grid-cols-2 2xl:gap-5">
            {whyChooseCards.map((card, index) => (
              <Card key={index} className="flex items-center gap-3 p-4">
                <div className="flex flex-col gap-1">
                  <h3 className="font-semibold leading-[1.2] 2xl:text-xl">{card.title}</h3>
                  <p className="text-sm text-muted-foreground">{card.description}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 2xl:gap-6">
          <h2 className="text-2xl font-semibold 2xl:text-3xl">Ready to deploy on the Supercloud?</h2>
          <div className="grid gap-3 md:grid-cols-2 2xl:gap-5">
            {readyToDeployStats.map((stat, index) => (
              <Card key={index} className="flex flex-col gap-1 p-5">
                <h2 className="text-3xl font-semibold leading-[1] 2xl:text-4xl">{stat.title}</h2>
                <p className="text-muted-foreground">{stat.description}</p>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop Form */}
      <div className="hidden w-full lg:flex">
        <GpuContactForm
          form={form}
          currentStep={currentStep}
          setCurrentStep={setCurrentStep}
          watchedUseCases={watchedUseCases}
          handleNextStep={handleNextStep}
          onSubmit={onSubmit}
          isSubmitting={isSubmitting}
        />
      </div>

      <Dialog open={showSuccessDialog} onOpenChange={setShowSuccessDialog}>
        <DialogContent>
          <DialogHeader>
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-green-500">
              <CheckCircle2 className="h-10 w-10 text-white" />
            </div>
            <DialogTitle className="text-center text-3xl font-bold">Success</DialogTitle>
            <DialogDescription className="mx-auto max-w-sm text-center text-lg leading-relaxed">
              Thank you for your interest! We've received your information and will be in touch soon with exciting updates.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-center">
            <Button onClick={() => setShowSuccessDialog(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface GpuContactFormProps {
  form: ReturnType<typeof useForm<z.infer<typeof formSchema>>>;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  watchedUseCases: string;
  handleNextStep: () => void;
  onSubmit: (values: z.infer<typeof formSchema>) => Promise<void>;
  isSubmitting: boolean;
}

function GpuContactForm({
  form,
  currentStep,
  setCurrentStep,
  watchedUseCases,
  handleNextStep,
  onSubmit,
  isSubmitting,
}: GpuContactFormProps) {
  return (
    <Card className="flex w-full flex-col gap-8 p-6 md:p-14">
      <h2 className="text-2xl font-medium">Tell Us What You Need</h2>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {currentStep === 1 && (
            <>
              <FormField
                control={form.control}
                name="lead_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      What would you like to do on Cloudana OS?
                      <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <div className="flex flex-col gap-3">
                        {["Rent GPUs", "Provide GPUs", "Get technical support", "Other"].map((option) => (
                          <label
                            key={option}
                            className="group relative flex cursor-pointer items-center gap-3 rounded-lg border bg-background p-4 transition-all duration-200 hover:border-primary hover:bg-primary/5 hover:shadow-sm"
                          >
                            <input
                              type="radio"
                              name="lead_type"
                              value={option}
                              checked={field.value === option}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  field.onChange(option);
                                }
                              }}
                              className="peer h-5 w-5 cursor-pointer appearance-none rounded-full border-2 border-gray-300 transition-all duration-200 checked:border-primary hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <span className="text-sm font-medium transition-colors duration-200 group-hover:text-primary">
                              {option}
                            </span>
                            {field.value === option && (
                              <div className="ml-auto">
                                <CheckCircle2 className="h-5 w-5 text-primary" />
                              </div>
                            )}
                          </label>
                        ))}
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchedUseCases && (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="firstname"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            First Name <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="John" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="lastname"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Last Name <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input placeholder="Doe" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Email <span className="text-red-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="business@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="company"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Company / Project Name <span className="text-red-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Acme Inc." {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {watchedUseCases === "Rent GPUs" && (
                    <FormField
                      control={form.control}
                      name="current_amount_spent_on_computer"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            How much are you currently spending on compute?
                            <span className="text-red-500">*</span>
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select your current spending" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="<$1000/mo">&lt;$1000/mo</SelectItem>
                              <SelectItem value="$1,000-$5,000">$1,000-$5,000</SelectItem>
                              <SelectItem value="$5,000-$25,000">$5,000-$25,000</SelectItem>
                              <SelectItem value="$25,000+">$25,000+</SelectItem>
                              <SelectItem value="No Spend Currently">No Spend Currently</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}

                  <Button
                    type="button"
                    onClick={handleNextStep}
                    className="!mt-8 h-auto w-auto rounded-md px-6 py-3"
                  >
                    Next
                  </Button>
                </>
              )}
            </>
          )}

          {currentStep === 2 && (
            <>
              <div className="mb-6">
                <h3 className="mb-2 text-lg font-semibold">
                  Share any additional details about your project
                </h3>
              </div>

              <FormField
                control={form.control}
                name="website"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Website URL</FormLabel>
                    <FormControl>
                      <Input placeholder="https://example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="project_details"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      Project Details <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Tell us about your project (minimum 10 characters)"
                        rows={4}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {watchedUseCases === "Provide GPUs" && (
                <>
                  <FormField
                    control={form.control}
                    name="provider_gpu_type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          What type of GPUs do you want to provide?
                          <span className="text-red-500">*</span>
                        </FormLabel>
                        <FormControl>
                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {["H200", "H100", "A100", "RTX4090", "A6000", "Other"].map((gpuType) => (
                              <div key={gpuType} className="flex items-center space-x-3">
                                <Checkbox
                                  checked={field.value?.includes(gpuType) || false}
                                  onCheckedChange={(checked) => {
                                    const currentValues = field.value || [];
                                    if (checked) {
                                      field.onChange([...currentValues, gpuType]);
                                    } else {
                                      field.onChange(currentValues.filter((value) => value !== gpuType));
                                    }
                                  }}
                                  id={`gpu-${gpuType}`}
                                />
                                <label
                                  htmlFor={`gpu-${gpuType}`}
                                  className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                >
                                  {gpuType}
                                </label>
                              </div>
                            ))}
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="gpu_quantity_available"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          How many total GPUs do you want to provide?
                          <span className="text-red-500">*</span>
                        </FormLabel>
                        <Select onValueChange={field.onChange} value={field.value || ""}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select quantity" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2-5">2-5</SelectItem>
                            <SelectItem value="5-10">5-10</SelectItem>
                            <SelectItem value="10+">10+</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              )}

              {watchedUseCases === "Get technical support" && (
                <FormField
                  control={form.control}
                  name="support_request_info"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Support Request Info <span className="text-red-500">*</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Describe your support request"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone Number</FormLabel>
                    <FormControl>
                      <Input placeholder="+1 (555) 123-4567" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <p className="!mt-8 text-xs text-muted-foreground md:text-sm">
                By clicking submit below, you consent to allow Cloudana OS to store and process the personal information submitted above to provide you the content requested.
              </p>

              <div className="flex gap-4">
                <Button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  variant="outline"
                  className="!mt-8 h-auto w-auto rounded-md px-6 py-3"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  className="!mt-8 h-auto w-auto rounded-md px-6 py-3"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Sending..." : "Submit"}
                </Button>
              </div>
            </>
          )}
        </form>
      </Form>
    </Card>
  );
}
