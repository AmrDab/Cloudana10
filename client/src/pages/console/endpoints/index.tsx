// Run → Endpoints tab (docs/V4_ENDPOINTS_CONTRACT.md): your endpoints, then the form to serve a new one.
import { useState } from "react";
import { Endpoints } from "./list";
import { NewEndpoint } from "./form";

export default function EndpointsTab() {
  const [focusId, setFocusId] = useState<string | null>(null);
  return (
    <>
      <Endpoints focusId={focusId} />
      <NewEndpoint
        onDone={(id) => {
          setFocusId(id);
          requestAnimationFrame(() => document.getElementById("endpoints")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }}
      />
    </>
  );
}
