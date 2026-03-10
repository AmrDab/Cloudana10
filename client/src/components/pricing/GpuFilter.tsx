import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { X, ChevronDown, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Gpus } from "@/pages/pricing/gpus";
import { modifyModel } from "@/pages/pricing/gpus";

export const defaultFilters = {
  modal: [] as string[],
  ram: [] as string[],
  interface: [] as string[],
};

export interface Filters {
  modal: string[];
  ram: string[];
  interface: string[];
}

interface Options {
  name: string;
  value: "modal" | "ram" | "interface";
  options: { name: string; value: string }[];
}

interface GpuFilterProps {
  setFilteredData: React.Dispatch<React.SetStateAction<Gpus["models"]>>;
  res?: Gpus;
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
}

// Helper function to get top models (similar to onTop from website)
const getTopModels = (res?: Gpus): Gpus["models"] => {
  if (!res?.models) return [];
  
  const modelPriorities = ["h200", "h100", "a100"];
  const filtered = res.models
    .filter((model) => modelPriorities.includes(model.model))
    .sort((a, b) => {
      const aIndex = modelPriorities.indexOf(a.model);
      const bIndex = modelPriorities.indexOf(b.model);
      if (aIndex !== bIndex) return aIndex - bIndex;
      return b.availability.available - a.availability.available;
    });
  
  const rest = res.models
    .filter((model) => !modelPriorities.includes(model.model))
    .sort((a, b) => b.availability.available - a.availability.available);
  
  return [...filtered, ...rest];
};

export default function GpuFilter({
  setFilteredData,
  res,
  filters,
  setFilters,
}: GpuFilterProps) {
  const data: Options[] = [
    { name: "Chipset", value: "modal", options: [] },
    { name: "vRAM", value: "ram", options: [] },
    { name: "Interface", value: "interface", options: [] },
  ];

  const [options, setOptions] = useState<Options[]>(data);

  useEffect(() => {
    const topModels = getTopModels(res);
    const modal = topModels.map((model) => model.model);
    const ram = res?.models?.map((model) => model.ram) || [];
    const interfaceTypes = res?.models?.map((model) => model.interface) || [];

    setOptions([
      {
        ...data[0],
        options: [...new Set(modal)].map((modal) => ({
          name: modifyModel(modal).charAt(0).toUpperCase() + modifyModel(modal).slice(1),
          value: modal,
        })),
      },
      {
        ...data[1],
        options: [...new Set(ram)]
          .map((ram) => ({ name: ram, value: ram }))
          .sort((a, b) => parseInt(b.name) - parseInt(a.name)),
      },
      {
        ...data[2],
        options: [...new Set(interfaceTypes)].map((interfaceType) => ({
          name: interfaceType,
          value: interfaceType,
        })),
      },
    ]);
  }, [res]);

  useEffect(() => {
    if (filters.modal.length > 0 || filters.ram.length > 0 || filters.interface.length > 0) {
      const filtered = res?.models
        ?.filter(
          (model) =>
            (filters.ram.includes(model.ram) || filters.ram.length === 0) &&
            (filters.modal.includes(model.model) || filters.modal.length === 0) &&
            (filters.interface.includes(model.interface) || filters.interface.length === 0),
        )
        .sort((a, b) => b.availability.available - a.availability.available);
      setFilteredData(filtered || []);
    } else {
      setFilteredData(res?.models || []);
    }
  }, [filters, res, setFilteredData]);

  const handleSelectOption = (item: Options, optionValue: string) => {
    if (filters[item.value].includes(optionValue)) {
      setFilters((prev) => ({
        ...prev,
        [item.value]: prev[item.value].filter((filter) => filter !== optionValue),
      }));
    } else {
      setFilters((prev) => ({
        ...prev,
        [item.value]: [...prev[item.value], optionValue],
      }));
    }
  };

  const removeFilter = (filterType: "modal" | "ram" | "interface", value: string) => {
    setFilters((prev) => ({
      ...prev,
      [filterType]: prev[filterType].filter((filter) => filter !== value),
    }));
  };

  const hasActiveFilters =
    filters.modal.length > 0 || filters.ram.length > 0 || filters.interface.length > 0;

  return (
    <div className="flex w-full flex-col">
      {/* Desktop Filter */}
      <div className="hidden items-center justify-between border-b pb-5 xl:flex">
        <div className="flex flex-1 flex-wrap gap-4">
          {options.map((item) => (
            <Popover key={item.name}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="px-4 hover:bg-accent">
                  <p className="mr-2.5 text-sm font-medium text-foreground">{item.name}</p>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56" align="start">
                <div className="flex flex-col gap-2">
                  {item.options.map((option) => {
                    const isSelected = filters[item.value].includes(option.value);
                    return (
                      <div key={option.value} className="flex items-center space-x-2">
                        <Checkbox
                          id={`${item.value}-${option.value}`}
                          checked={isSelected}
                          onCheckedChange={() => handleSelectOption(item, option.value)}
                        />
                        <label
                          htmlFor={`${item.value}-${option.value}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {option.name}
                        </label>
                      </div>
                    );
                  })}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFilters((prev) => ({
                      ...prev,
                      [item.value]: [],
                    }));
                  }}
                  className="mt-2 w-full text-xs"
                >
                  Clear {item.name}
                </Button>
              </PopoverContent>
            </Popover>
          ))}
        </div>
      </div>

      {/* Mobile Filter */}
      <div className="xl:hidden">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-4 w-4" />
              Filter
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56" align="end">
            <div className="space-y-4">
              {options.map((item) => (
                <Collapsible key={item.name} defaultOpen={filters[item.value].length > 0}>
                  <CollapsibleTrigger className="group flex w-full items-center justify-between text-sm font-bold">
                    <span>{item.name}</span>
                    <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-0 group-data-[state=closed]:-rotate-90" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    {item.options.map((option) => {
                      const isSelected = filters[item.value].includes(option.value);
                      return (
                        <div key={option.value} className="flex items-center space-x-2">
                          <Checkbox
                            id={`mobile-${item.value}-${option.value}`}
                            checked={isSelected}
                            onCheckedChange={() => handleSelectOption(item, option.value)}
                          />
                          <label
                            htmlFor={`mobile-${item.value}-${option.value}`}
                            className="text-sm font-medium leading-none cursor-pointer"
                          >
                            {option.name}
                          </label>
                        </div>
                      );
                    })}
                  </CollapsibleContent>
                </Collapsible>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFilters(defaultFilters)}
                className="w-full text-xs"
              >
                Clear All
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 border-b py-3">
          <div className="mr-2 text-sm font-medium">Active filters:</div>
          {options.map((item) =>
            filters[item.value].map((filterValue) => {
              const optionName =
                item.options.find((o) => o.value === filterValue)?.name || filterValue;
              return (
                <Badge
                  key={`${item.value}-${filterValue}`}
                  variant="secondary"
                  className="inline-flex items-center gap-1 px-3 py-1"
                >
                  <span className="font-medium">{item.name}:</span>
                  <span className="font-semibold">{optionName}</span>
                  <button
                    onClick={() => removeFilter(item.value, filterValue)}
                    className="ml-1 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              );
            }),
          )}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilters(defaultFilters)}
              className="ml-auto text-xs"
            >
              Clear all
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
