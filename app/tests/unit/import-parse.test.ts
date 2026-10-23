import { describe, expect, it } from "vitest";
import { parseCsv, parseFile, toJurisdiction, toWorkDays, TEMPLATE_CSV } from "@/lib/importPeople";

describe("CSV parsing", () => {
  it("handles quotes, embedded commas, doubled quotes, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\nlast,\n')).toEqual([["a", "b"], ["x, y", 'say "hi"'], ["last", ""]]);
  });
  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a\n"line1\nline2"\n')).toEqual([["a"], ["line1\nline2"]]);
  });
});

describe("parseFile", () => {
  it("maps header aliases and reports unknown columns", async () => {
    const r = await parseFile("p.csv", Buffer.from("Name,Work Email,Hire date,Province,Shoe size\nA,a@x.example,2024-01-01,ON,9\n"));
    expect(r).toMatchObject({ ok: true, present: ["full_name", "email", "start_date", "province_or_state"], unknown: ["Shoe size"] });
  });
  it("rejects wrong types, empty files, missing email column, duplicates and oversize files", async () => {
    expect(await parseFile("p.txt", Buffer.from("x"))).toMatchObject({ ok: false });
    expect(await parseFile("p.csv", Buffer.from(""))).toMatchObject({ ok: false, error: "The file is empty." });
    expect(await parseFile("p.csv", Buffer.from("name\nA\n"))).toMatchObject({ ok: false, error: expect.stringMatching(/email column/) });
    expect(await parseFile("p.csv", Buffer.from("email,Work email\na,b\n"))).toMatchObject({ ok: false, error: expect.stringMatching(/twice/) });
    expect(await parseFile("p.csv", Buffer.alloc(2 * 1024 * 1024 + 1, 97))).toMatchObject({ ok: false, error: expect.stringMatching(/2 MB/) });
    expect(await parseFile("p.xlsx", Buffer.from("not a zip"))).toMatchObject({ ok: false, error: expect.stringMatching(/Excel/) });
  });
  it("parses the downloadable template", async () => {
    const r = await parseFile("t.csv", Buffer.from(TEMPLATE_CSV));
    expect(r.ok && r.rows).toHaveLength(2);
  });
});

describe("value normalising", () => {
  it("reads provinces and states by code or name", () => {
    expect(["ON", "on", "CA-ON", "Ontario", "QC", "Quebec", "CA", "California", "US-NY", "new york"].map(toJurisdiction))
      .toEqual(["CA-ON", "CA-ON", "CA-ON", "CA-ON", "CA-QC", "CA-QC", "US-CA", "US-CA", "US-NY", "US-NY"]);
    expect(toJurisdiction("XX")).toBeNull();
    expect(toJurisdiction("CA-XX")).toBeNull();
  });
  it("reads work days as ranges, lists or numbers", () => {
    expect(toWorkDays("Mon-Fri")).toEqual([1, 2, 3, 4, 5]);
    expect(toWorkDays("mon, wed, fri")).toEqual([1, 3, 5]);
    expect(toWorkDays("Tuesday Thursday")).toEqual([2, 4]);
    expect(toWorkDays("1,2,3")).toEqual([1, 2, 3]);
    expect(toWorkDays("Fri-Mon")).toBeNull();
    expect(toWorkDays("weekdays")).toBeNull();
  });
});
