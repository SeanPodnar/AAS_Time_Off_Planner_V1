function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Text colour for buttons filled with the brand colour: white when it is readable (3:1 for large UI text), else dark. */
export function brandInk(brand: string): string {
  return contrastRatio(brand, "#ffffff") >= 3 ? "#ffffff" : "#0d1b2e";
}

/** WCAG AA for normal text against white. */
export function meetsAA(brand: string): boolean {
  return contrastRatio(brand, "#ffffff") >= 4.5;
}
