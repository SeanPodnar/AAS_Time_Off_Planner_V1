// XLSX and CSV export of a report (FR-79). The XLSX is written directly as Office Open XML
// (zipped with fflate): run label and filters in the first rows, header row frozen, auto-filter
// on, dates as real dates, numbers right-aligned with their decimals. CSV is UTF-8 with a BOM so
// Excel opens accents correctly, and cells that start with = + - @ are prefixed so a spreadsheet
// never runs them as formulas.
import { strToU8, zipSync } from "fflate";
import type { Cell, Column, Report } from "./types";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");

/** Spreadsheet formula injection guard for text cells (OWASP CSV injection). */
export function safeText(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Excel stores dates as days since 1899-12-30.
const serial = (iso: string) => (Date.parse(`${iso}T00:00:00Z`) - Date.parse("1899-12-30T00:00:00Z")) / 86_400_000;

// Styles: 0 default, 1 bold (header and labels), 2 date, 3 two decimals, 4 integer, 5 percent, 6 bold two decimals, 7 italic (run label)
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="d mmm yyyy"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><i/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

function cellXml(ref: string, c: Column | null, v: Cell, bold = false): string {
  if (v === null || v === "") return "";
  if (typeof v === "number") {
    const style = c?.type === "percent" ? 5 : bold ? 6 : c?.decimals === 0 ? 4 : 3;
    return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  }
  if (c?.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="2"><v>${serial(v)}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${bold ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
}

/** The report as an .xlsx file. */
export function toXlsx(r: Report): Uint8Array {
  const rows: string[] = [];
  let n = 0;
  const line = (cells: string) => { n++; rows.push(`<row r="${n}">${cells}</row>`); };
  line(cellXml(`A${n + 1}`, null, r.title, true));
  line(cellXml(`A${n + 1}`, null, r.companyName));
  line(`<c r="A${n + 1}" t="inlineStr" s="7"><is><t xml:space="preserve">${xml(r.runLabel)}</t></is></c>`);
  for (const f of r.filters) line(cellXml(`A${n + 1}`, null, f));
  line("");
  const header = n + 1;
  line(r.columns.map((c, i) => cellXml(`${colName(i)}${header}`, null, c.label, true)).join(""));
  for (const row of r.rows) line(r.columns.map((c, i) => cellXml(`${colName(i)}${n + 1}`, c, row[c.key] ?? null)).join(""));
  const last = n;
  if (r.totals) line(r.columns.map((c, i) => cellXml(`${colName(i)}${n + 1}`, c, r.totals![c.key] ?? null, true)).join(""));
  for (const note of r.notes) line(cellXml(`A${n + 1}`, null, note));

  const lastCol = colName(Math.max(0, r.columns.length - 1));
  const widths = r.columns.map((c, i) => {
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 500).map((row) => String(row[c.key] ?? "").length));
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(60, Math.max(10, longest + 2))}" customWidth="1"/>`;
  }).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${header}" topLeftCell="A${header + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols>
<sheetData>${rows.join("")}</sheetData>
<autoFilter ref="A${header}:${lastCol}${Math.max(header, last)}"/>
</worksheet>`;
  const sheetName = xml(r.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${sheetName.replace(/'/g, "''")}'!$A$${header}:$${lastCol}$${Math.max(header, last)}</definedName></definedNames>
</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  };
  return zipSync(files, { level: 6 });
}

const csvCell = (v: Cell) => {
  if (v === null) return "";
  const s = typeof v === "number" ? String(v) : safeText(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The report as CSV (UTF-8 with BOM), run label and filters first, then the table. */
export function toCsv(r: Report): string {
  const lines = [[r.title], [r.companyName], [r.runLabel], ...r.filters.map((f) => [f]), [],
    r.columns.map((c) => c.label),
    ...r.rows.map((row) => r.columns.map((c) => row[c.key] ?? null)),
    ...(r.totals ? [r.columns.map((c) => r.totals![c.key] ?? null)] : []),
    ...r.notes.map((n) => [n])];
  return "﻿" + lines.map((l) => l.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const fileName = (r: Report, ext: "xlsx" | "csv", date: string) => `${r.title.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${date}.${ext}`;
