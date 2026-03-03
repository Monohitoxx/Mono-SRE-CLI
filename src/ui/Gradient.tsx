import React from "react";
import { Text } from "ink";
import InkGradient from "ink-gradient";

const GRADIENT_COLORS = ["#00d4ff", "#7b2ff7", "#ff2d95"];

interface GradientTextProps {
  children: React.ReactNode;
}

export function GradientText({ children }: GradientTextProps) {
  return (
    <InkGradient colors={GRADIENT_COLORS}>
      <Text>{children}</Text>
    </InkGradient>
  );
}
