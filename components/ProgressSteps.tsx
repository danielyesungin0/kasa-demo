import { cn } from "@/lib/cn";

type ProgressStepsProps = {
  steps: string[];
  currentStep: number; // 1-indexed
};

export function ProgressSteps({ steps, currentStep }: ProgressStepsProps) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((label, i) => {
        const stepNum = i + 1;
        const isActive = stepNum === currentStep;
        const isComplete = stepNum < currentStep;
        return (
          <div key={label} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium transition",
                isComplete && "bg-ink-900 text-cream-50",
                isActive && "bg-accent text-cream-50",
                !isActive && !isComplete && "bg-cream-200 text-ink-500"
              )}
            >
              {isComplete ? "✓" : stepNum}
            </div>
            <span
              className={cn(
                "hidden text-sm sm:block",
                isActive ? "font-medium text-ink-900" : "text-ink-500"
              )}
            >
              {label}
            </span>
            {i < steps.length - 1 && (
              <div className="ml-1 hidden h-px flex-1 bg-ink-200 sm:block" />
            )}
          </div>
        );
      })}
    </div>
  );
}
