import { ReactNode } from "react";

type Props = { label: string; value: ReactNode };

export function LabelValue({ label, value }: Props) {
  if (value == null || value === "") return null;
  return (
    <div className="mb-2">
      <span className="text-muted-foreground text-xs">{label}</span>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}
