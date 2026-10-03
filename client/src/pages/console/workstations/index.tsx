// Run → Workstations tab (docs/WORKSTATIONS.md §7): your workstations, then the spec picker to rent one.
import { useState } from "react";
import { Workstations } from "./list";
import { SpecPicker } from "./spec-picker";

const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));

export default function WorkstationsTab() {
  const [focusId, setFocusId] = useState<string | null>(null);
  return (
    <>
      <Workstations focusId={focusId} onRent={() => scrollTo("rent")} />
      <SpecPicker
        onDone={(id) => {
          setFocusId(id);
          scrollTo("workstations");
        }}
      />
    </>
  );
}
