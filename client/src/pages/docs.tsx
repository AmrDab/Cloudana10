import { FileText, ExternalLink, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function DocsPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8 py-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <h1 className="text-3xl font-bold">Documentation</h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Comprehensive guides for users and providers on the Cloudana network.
        </p>
      </div>

      {/* Coming soon banner */}
      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="py-6">
          <div className="flex items-start gap-4">
            <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-foreground">Full documentation coming soon</p>
              <p className="text-sm text-muted-foreground">
                We're actively writing comprehensive guides. In the meantime, explore the resources below.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick links */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-white/10 hover:border-primary/30 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">GitHub Repository</CardTitle>
            <CardDescription>
              Source code, issue tracker, and contribution guides.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href="https://github.com/cloudana-io"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                View on GitHub
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-white/10 hover:border-primary/30 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Block Explorer</CardTitle>
            <CardDescription>
              Inspect on-chain activity on Base Sepolia testnet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a
              href="https://sepolia.basescan.org"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                Open Explorer
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-white/10 hover:border-primary/30 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Community</CardTitle>
            <CardDescription>
              Join the conversation on Discord and Twitter.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2 flex-wrap">
            <a href="https://discord.gg/cloudana" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                Discord
              </Button>
            </a>
            <a href="https://twitter.com/Cloudana10" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                Twitter
              </Button>
            </a>
          </CardContent>
        </Card>

        <Card className="border-white/10 hover:border-primary/30 transition-colors">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Network Status</CardTitle>
            <CardDescription>
              Check the live status of the Cloudana network and contracts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/status">
              <Button variant="outline" size="sm" className="gap-2">
                View Status
              </Button>
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
