import { Suspense } from "react";
import { IndicatorsView } from "@/ui/indicators";

export default function Page() {
  return (
    <Suspense>
      <IndicatorsView />
    </Suspense>
  );
}
