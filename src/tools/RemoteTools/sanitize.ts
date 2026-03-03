const SAFE_SERVICE_RE = /^[A-Za-z0-9@_.:-]+$/;

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function assertAbsolutePath(pathValue: string, fieldName: string): string {
  const v = pathValue.trim();
  if (!v) {
    throw new Error(`${fieldName} cannot be empty.`);
  }
  if (!v.startsWith("/")) {
    throw new Error(`${fieldName} must be an absolute path.`);
  }
  if (/[\0\r\n]/.test(v)) {
    throw new Error(`${fieldName} contains invalid characters.`);
  }
  return v;
}

export function assertServiceName(service: string): string {
  const v = service.trim();
  if (!v) {
    throw new Error("service cannot be empty.");
  }
  if (!SAFE_SERVICE_RE.test(v)) {
    throw new Error(
      "Invalid service name. Allowed characters: letters, numbers, @ _ . : -",
    );
  }
  return v;
}

export function parsePort(value: string): number {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port "${value}". Port must be between 1 and 65535.`);
  }
  return parsed;
}

export function assertHttpUrl(value: string): string {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new Error(`Invalid URL "${value}".`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Unsupported URL scheme "${u.protocol}". Use http:// or https://.`);
  }
  return u.toString();
}

export function parseStdout(output: string): string {
  const start = output.indexOf("stdout:\n");
  if (start === -1) return "";

  const afterStdout = output.slice(start + "stdout:\n".length);
  const stderrIdx = afterStdout.indexOf("\nstderr:");
  const exitIdx = afterStdout.indexOf("\nexit code:");

  const end = stderrIdx !== -1
    ? stderrIdx
    : exitIdx !== -1
      ? exitIdx
      : afterStdout.length;

  return afterStdout.slice(0, end).trim();
}
