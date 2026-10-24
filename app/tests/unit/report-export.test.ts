import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { fileName, safeText, toCsv, toXlsx } from "../../src/lib/reports/export";
import { totalsRow, type Report } from "../../src/lib/reports/types";

const columns = [
  { key: "person", label: "Person", type: "text" as const },
  { key: "day", label: "First day", type: "date" as const },
  { key: "days", label: "Days", type: "number" as const },
  { key: "rate", label: "Absence rate", type: "percent" as const },
];
const rows = [
  { person: "Maya Chen", day: "2026-11-02", days: 2.5, rate: 0.05 },
  { person: "=HYPERLINK(\"http://evil\")", day: "2026-11-03", days: 1, rate: null },
];
const report: Report = {
  key: "t", title: "Who's out", companyName: "Northwind Analytics Inc.", runLabel: "Run on 24 Oct 2026, 09:15 EDT by Priya Shah",
  filters: ["From 2 Nov 2026 to 6 Nov 2026"], columns, rows, totals: totalsRow(columns, rows, ["days"]), notes: ["A note"],
};

describe("report export", () => {
  it("adds up totals only for the named columns", () => {
    expect(report.totals).toEqual({ person: "Total", day: null, days: 3.5, rate: null });
  });

  it("writes an xlsx with the run label first, a frozen header, filters and real dates", () => {
    const files = unzipSync(toXlsx(report));
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    // Title, company, run label, one filter, blank row: the header is row 6.
    expect(sheet).toContain('<pane ySplit="6" topLeftCell="A7" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A6:D8"/>');
    expect(sheet).toContain("Run on 24 Oct 2026, 09:15 EDT by Priya Shah");
    expect(sheet).toContain('<c r="B7" s="2"><v>46328</v></c>'); // 2 Nov 2026 as an Excel date
    expect(sheet).toContain('<c r="D7" s="5"><v>0.05</v></c>'); // percent style
    expect(sheet).toContain("&quot;http://evil&quot;"); // escaped
    expect(strFromU8(files["xl/workbook.xml"])).toContain('<sheet name="Who&apos;s out"'.replace("&apos;", "'"));
  });

  it("writes CSV with a BOM and neutralises formulas", () => {
    const csv = toCsv(report);
    expect(csv.startsWith("﻿Who's out\r\nNorthwind Analytics Inc.\r\n")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\")\",2026-11-03,1,");
    expect(csv).toContain("Total,,3.5,");
    expect(safeText("-1+1")).toBe("'-1+1");
    expect(safeText("Maya")).toBe("Maya");
  });

  it("names files after the report and date", () => {
    expect(fileName(report, "xlsx", "2026-10-24")).toBe("who-s-out-2026-10-24.xlsx");
  });
});
