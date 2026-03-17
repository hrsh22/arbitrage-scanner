import { HeroSection } from "@/components/landing/HeroSection";
import { ThesisSection } from "@/components/landing/ThesisSection";
import { TransformationSection } from "@/components/landing/TransformationSection";
import { AllocatorsSection } from "@/components/landing/AllocatorsSection";
import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { AgentCuratorSection } from "@/components/landing/AgentCuratorSection";
import { InfrastructureTrustSection } from "@/components/landing/InfrastructureTrustSection";
import { ShowcaseSection } from "@/components/landing/ShowcaseSection";
import { VisionSection } from "@/components/landing/VisionSection";

export default function LandingPage() {
  return (
    <main className="flex-1 overflow-y-auto w-full max-w-[100vw]">
      <HeroSection />
      <ThesisSection />
      <TransformationSection />
      <AllocatorsSection />
      <HowItWorksSection />
      <AgentCuratorSection />
      <InfrastructureTrustSection />
      <ShowcaseSection />
      <VisionSection />
      {/* Spacer at bottom */}
      <div className="h-24" />
    </main>
  );
}
