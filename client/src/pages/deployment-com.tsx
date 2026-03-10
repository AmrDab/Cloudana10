import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Check } from "lucide-react";
import { useLocation } from "wouter";

export default function DeploymentCom() {
  const [, setLocation] = useLocation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center p-6">
      <Card className="w-full max-w-md border-white/10 bg-card/40">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20">
              <Check className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Create deployment completion</CardTitle>
              <CardDescription>Your deployment has been submitted.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            variant="default"
            className="w-full"
            onClick={() => setLocation("/user#deployments")}
          >
            Back to Deployments
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
