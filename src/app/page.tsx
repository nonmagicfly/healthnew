import { StatePanel } from "@/ui/state-panel";
import { IndicatorSummaryCard } from "@/ui/indicators";
import { ChatPanel } from "@/ui/chat";

export default function Home() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <StatePanel />
        <IndicatorSummaryCard />
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <ChatPanel compact />
      </div>
    </div>
  );
}
