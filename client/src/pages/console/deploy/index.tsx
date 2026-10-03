// Run → Deploy tab (docs/V3_CONTRACT.md §7): your deployments, then the templates catalog with its detail sheet.
import { useState } from "react";
import { Deployments } from "./deployments";
import { TemplatesBrowser, type ListedTemplate } from "./templates";
import { TemplateSheet } from "./template-detail";

export default function DeployTab() {
  const [sheet, setSheet] = useState<{ open: boolean; template: ListedTemplate | null }>({ open: false, template: null });
  const [focusId, setFocusId] = useState<string | null>(null);

  return (
    <>
      <Deployments focusId={focusId} onBlank={() => setSheet({ open: true, template: null })} />
      <TemplatesBrowser onOpen={(t) => setSheet({ open: true, template: t })} onBlank={() => setSheet({ open: true, template: null })} />
      <TemplateSheet
        open={sheet.open}
        template={sheet.template}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        onDeployed={(id) => {
          setFocusId(id);
          requestAnimationFrame(() => document.getElementById("deployments")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }}
      />
    </>
  );
}
