import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

export type StepStatus = "pending" | "in_progress" | "done";

export interface PlanStepState {
  id: number;
  title: string;
  status: StepStatus;
}

export interface ActivePlan {
  title: string;
  steps: PlanStepState[];
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function StepIcon({ status }: { status: StepStatus }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (status !== "in_progress") return;
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 500);
    return () => clearInterval(timer);
  }, [status]);

  switch (status) {
    case "done":
      return <Text color="green">✓</Text>;
    case "in_progress":
      return <Text color="yellow">{SPINNER_FRAMES[frame]}</Text>;
    case "pending":
      return <Text dimColor>○</Text>;
  }
}

const MAX_VISIBLE_STEPS = 7;

export function PlanProgress({ plan }: { plan: ActivePlan }) {
  const doneCount = plan.steps.filter((s) => s.status === "done").length;
  const total = plan.steps.length;

  // Sliding window: keep the active step visible, prefer showing recent progress
  const activeIdx = plan.steps.findIndex((s) => s.status === "in_progress");
  let windowStart = 0;
  if (total > MAX_VISIBLE_STEPS) {
    if (activeIdx === -1) {
      windowStart = total - MAX_VISIBLE_STEPS;
    } else {
      windowStart = Math.max(0, Math.min(activeIdx - 2, total - MAX_VISIBLE_STEPS));
    }
  }
  const windowEnd = Math.min(total, windowStart + MAX_VISIBLE_STEPS);
  const visibleSteps = plan.steps.slice(windowStart, windowEnd);
  const hiddenBefore = windowStart;
  const hiddenAfter = total - windowEnd;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={0}
    >
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          {plan.title}
        </Text>
        <Text dimColor>
          {doneCount}/{total}
        </Text>
      </Box>
      {hiddenBefore > 0 && (
        <Text dimColor>  ⋯ {hiddenBefore} completed</Text>
      )}
      {visibleSteps.map((step) => (
        <Box key={step.id} gap={1}>
          <StepIcon status={step.status} />
          <Text
            color={
              step.status === "done"
                ? "green"
                : step.status === "in_progress"
                  ? "yellow"
                  : undefined
            }
            dimColor={step.status === "pending"}
          >
            {step.id}. {step.title}
          </Text>
        </Box>
      ))}
      {hiddenAfter > 0 && (
        <Text dimColor>  ⋯ {hiddenAfter} more</Text>
      )}
    </Box>
  );
}
