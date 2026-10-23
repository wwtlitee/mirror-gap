export function skyState(hour) {
  const h = ((Number.isFinite(hour) ? hour : 12) % 24 + 24) % 24;
  const angle = (h - 6) / 12 * Math.PI;
  const elevation = Math.sin(angle);
  const daylight = Math.max(0, Math.min(1, elevation * 1.3));
  const twilight = Math.max(0, 1 - Math.min(Math.abs(h-6), Math.abs(h-18)) / 1.5);
  return { hour:h, daylight, twilight,
    sun: [3-Math.cos(angle)*24, 3+elevation*13, -64],
    moon: [3+Math.cos(angle)*24, 3-elevation*13, -64],
    sunVisible:elevation>-.08, moonVisible:elevation<.08 };
}
