/** Parses `15m`, `90s`, `2h`, `7d` into whole seconds for Redis TTL and OAuth-style `expires_in`. */
export function durationToSeconds(value: string): number {
  const m = /^([1-9]\d*)([smhd])$/.exec(value.trim());
  if (!m)
    throw new Error(`invalid duration: ${JSON.stringify(value)}`);
  const n = Number(m[1]);
  const unit = m[2];
  switch (unit) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    default:
      throw new Error(`unsupported unit: ${unit}`);
  }
}
