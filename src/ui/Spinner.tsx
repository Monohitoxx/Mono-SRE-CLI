import React, { useState, useEffect } from "react";
import { Text } from "ink";

const FRAMES = ["◐", "◓", "◑", "◒"];
const INTERVAL = 200;

interface SpinnerProps {
  label: string;
  elapsedMs: number;
  tokens: number;
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

export function Spinner({ label, elapsedMs, tokens }: SpinnerProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % FRAMES.length);
    }, INTERVAL);
    return () => clearInterval(timer);
  }, []);

  const parts = [FRAMES[frame], ` ${label} ${formatElapsed(elapsedMs)}`];
  if (tokens > 0) {
    parts.push(` · ${formatTokens(tokens)} tokens`);
  }

  return <Text color="yellow">{parts.join("")}</Text>;
}
