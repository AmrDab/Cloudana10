// Run → Machines tab (docs/WORKSTATIONS.md §11): your machines (the workstations list, filtered), then the form to rent one.
import { useState } from "react";
import { Workstations } from "@/pages/console/workstations/list";
import { MachinePicker } from "./picker";

const scrollTo = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));

export default function MachinesTab() {
  const [focusId, setFocusId] = useState<string | null>(null);
  return (
    <>
      <Workstations variant="machines" focusId={focusId} onRent={() => scrollTo("rent-machine")} />
      <MachinePicker
        onDone={(id) => {
          setFocusId(id);
          scrollTo("machines");
        }}
      />
    </>
  );
}
