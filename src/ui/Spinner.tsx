import React, { useState, useEffect, useRef } from "react";
import { Text } from "ink";

const FRAMES = ["◐", "◓", "◑", "◒"];
const TICK_MS = 500;

interface SpinnerProps {
  label: string;
  startTime?: number;
  tokens?: number;
}

function formatElapsed(ms: number): string {
  const secs = ms / 1000;
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = Math.floor(secs % 60);
  return `${mins}m${remainSecs}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export const Spinner = React.memo(function Spinner({
  label,
  startTime,
  tokens,
}: SpinnerProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick((prev) => prev + 1);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const frameIdx = tick % FRAMES.length;
  const elapsed = startTime ? Date.now() - startTime : 0;

  const parts = [FRAMES[frameIdx], ` ${label} ${formatElapsed(elapsed)}`];
  if (tokens && tokens > 0) {
    parts.push(` · ${formatTokens(tokens)} tokens`);
  }

  return <Text color="yellow">{parts.join("")}</Text>;
});
