import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Props = {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  id?: string;
  className?: string;
};

export function CheckboxWithLabel({
  checked,
  onCheckedChange,
  label,
  id,
  className,
}: Props) {
  const uid = id ?? `cb-${label.replace(/\W/g, "-")}`;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Checkbox
        id={uid}
        checked={checked}
        onCheckedChange={(v) => onCheckedChange(v === true)}
      />
      <Label htmlFor={uid} className="cursor-pointer text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}
