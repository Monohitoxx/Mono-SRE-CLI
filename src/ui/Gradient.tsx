import React, { useEffect, useState } from "react";
import { Text } from "ink";
import InkGradient from "ink-gradient";

const GRADIENT_SETS = [
  ["#22d3ee", "#3b82f6", "#f97316"],
  ["#34d399", "#06b6d4", "#6366f1"],
  ["#f59e0b", "#ef4444", "#ec4899"],
];
const ANIM_INTERVAL_MS = 1800;

interface GradientTextProps {
  children: React.ReactNode;
}

export function GradientText({ children }: GradientTextProps) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIdx((prev) => (prev + 1) % GRADIENT_SETS.length);
    }, ANIM_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <InkGradient colors={GRADIENT_SETS[idx]}>
      <Text>{children}</Text>
    </InkGradient>
  );
}
