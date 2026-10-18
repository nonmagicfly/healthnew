import { Suspense } from "react";
import { DocumentDetailView } from "@/ui/document-detail";

export default function Page() {
  return (
    <Suspense>
      <DocumentDetailView />
    </Suspense>
  );
}
