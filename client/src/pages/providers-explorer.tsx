import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getAllProviders } from "@/lib/api";
import { Search, Server, Zap } from "lucide-react";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProvidersExplorer() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  
  const { data: providers = [], isLoading } = useQuery({
    queryKey: ["providers"],
    queryFn: getAllProviders,
  });

  const filteredProviders = useMemo(() => 
    providers.filter(p => 
      p.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      p.address.toLowerCase().includes(searchTerm.toLowerCase())
    ),
    [providers, searchTerm]
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Provider Explorer</h1>
          <p className="text-muted-foreground">Find high-performance compute nodes for your workload.</p>
        </div>
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or address..." 
            className="pl-9 bg-card/50 border-white/10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="border-white/5">
              <CardHeader>
                <Skeleton className="h-10 w-10 rounded-lg mb-2" />
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          ))
        ) : filteredProviders.map((provider) => (
          <Card key={provider.id} className="group hover:border-primary/50 transition-all duration-300 overflow-hidden bg-card/60 backdrop-blur-sm border-white/5">
             <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            
            <CardHeader className="relative">
              <div className="flex justify-between items-start mb-2">
                 <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                    <Server className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                 </div>
                 <Badge variant={provider.status === 'active' ? 'default' : 'secondary'} className={provider.status === 'active' ? 'bg-primary/20 text-primary hover:bg-primary/30' : ''}>
                   {provider.status}
                 </Badge>
              </div>
              <CardTitle className="text-xl group-hover:text-primary transition-colors">{provider.name}</CardTitle>
              <div className="font-mono text-xs text-muted-foreground bg-black/20 px-2 py-1 rounded w-fit">
                {provider.address}
              </div>
            </CardHeader>
            <CardContent className="relative space-y-4">
               <div className="grid grid-cols-2 gap-4 text-sm">
                 <div className="space-y-1">
                   <span className="text-muted-foreground text-xs">Pricing</span>
                   <div className="font-bold text-foreground">{parseFloat(provider.pricing).toFixed(2)} CLD/hr</div>
                 </div>
                 <div className="space-y-1">
                   <span className="text-muted-foreground text-xs">Uptime</span>
                   <div className="font-bold text-green-400">99.9%</div>
                 </div>
               </div>
            </CardContent>
            <CardFooter className="relative border-t border-white/5 pt-4">
              <Button onClick={() => setLocation('/user')} className="w-full group-hover:bg-primary group-hover:text-primary-foreground transition-colors" variant="outline">
                <Zap className="mr-2 h-4 w-4" /> Select Provider
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
}
