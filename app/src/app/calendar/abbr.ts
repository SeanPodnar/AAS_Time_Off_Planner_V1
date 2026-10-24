/** Short, unique abbreviations for calendar labels. "Out of office" is "OoO"; others use initials or leading letters. */
export function abbreviations(labels: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const label of [...new Set(labels)].sort((a, b) => a.localeCompare(b))) {
    const words = label.split(/\s+/).filter(Boolean);
    const compact = words.join("");
    const candidates: string[] = [];
    if (label.toLowerCase() === "out of office") candidates.push("OoO");
    if (words.length === 1) candidates.push(compact.slice(0, 1).toUpperCase());
    else candidates.push(words.map((w) => w[0]).join("").slice(0, 3).toUpperCase());
    for (let n = 2; n <= compact.length; n++) candidates.push(compact.slice(0, n).replace(/^./, (c) => c.toUpperCase()));
    candidates.push(compact);
    const pick = candidates.find((c) => c && !used.has(c)) ?? compact;
    used.add(pick);
    out.set(label, pick);
  }
  return out;
}
