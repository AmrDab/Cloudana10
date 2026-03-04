import { useState, useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { Filters } from "./GpuFilter";
import type { Gpus } from "@/pages/pricing/gpus";

const sortOptions = [
  { title: "Availability" },
  { title: "Lowest Price" },
  { title: "Highest Price" },
];

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

interface GpuSortProps {
  setFilteredData: React.Dispatch<React.SetStateAction<Gpus["models"]>>;
  res?: Gpus;
  filters: Filters;
}

export default function GpuSort({ setFilteredData, res, filters }: GpuSortProps) {
  const [selected, setSelected] = useState(sortOptions[0]);

  useEffect(() => {
    const sortData = (sortType: string) => {
      switch (sortType) {
        case "Availability":
          if (
            filters.modal.length > 0 ||
            filters.ram.length > 0 ||
            filters.interface.length > 0
          ) {
            setFilteredData((prev) =>
              [...prev].sort(
                (a, b) => b.availability.available - a.availability.available,
              ),
            );
          } else {
            setFilteredData(getTopModels(res));
          }
          break;
        case "Lowest Price":
          setFilteredData((prev) =>
            [...prev].sort((a, b) => {
              const aMed = a.price ? a.price.med : 0;
              const bMed = b.price ? b.price.med : 0;
              return aMed - bMed;
            }),
          );
          break;
        case "Highest Price":
          setFilteredData((prev) =>
            [...prev].sort((a, b) => {
              const aMed = a.price ? a.price.med : 0;
              const bMed = b.price ? b.price.med : 0;
              return bMed - aMed;
            }),
          );
          break;
        default:
          break;
      }
    };
    sortData(selected.title);
  }, [selected, res?.models, setFilteredData, filters]);

  return (
    <Select
      value={selected.title}
      onValueChange={(value) => {
        const option = sortOptions.find((opt) => opt.title === value);
        if (option) setSelected(option);
      }}
    >
      <SelectTrigger className="w-[180px]">
        {selected.title}
      </SelectTrigger>
      <SelectContent>
        {sortOptions.map((option) => (
          <SelectItem key={option.title} value={option.title}>
            {option.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
