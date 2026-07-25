"use client";

import { useEffect, useState, useMemo } from "react";
import * as XLSX from "xlsx";
import { base64ToUint8Array } from "@/lib/file-utils";

interface XlsxRendererProps {
  content: string;
  encoding: "utf-8" | "base64";
}

interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

export function XlsxRenderer({ content, encoding }: XlsxRendererProps) {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!content) return;

    try {
      const data =
        encoding === "base64"
          ? base64ToUint8Array(content)
          : new TextEncoder().encode(content);

      const workbook = XLSX.read(data, { type: "array" });

      const parsed: SheetData[] = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        const json = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });

        if (json.length === 0) {
          return { name, headers: [], rows: [] };
        }

        return {
          name,
          headers: json[0].map(String),
          rows: json.slice(1).map((row) => row.map(String)),
        };
      });

      // eslint-disable-next-line react-hooks/set-state-in-effect -- XLSX.read is a heavy synchronous parse; keeping it out of render also lets activeSheet reset with the new workbook
      setSheets(parsed);
      setActiveSheet(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse spreadsheet");
    }
  }, [content, encoding]);

  const current = useMemo(() => sheets[activeSheet] ?? null, [sheets, activeSheet]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (sheets.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground animate-pulse">Parsing spreadsheet...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Sheet tabs */}
      {sheets.length > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {sheets.map((sheet, i) => (
            <button
              key={i}
              onClick={() => setActiveSheet(i)}
              className={`px-3 py-1 text-xs rounded-md whitespace-nowrap transition-colors ${
                i === activeSheet
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted"
              }`}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}

      {/* Table */}
      {current && current.headers.length > 0 && (
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full text-xs font-mono">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr>
                {current.headers.map((h, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap border-b border-border"
                  >
                    {h || `Col ${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {current.rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 whitespace-nowrap">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 text-[10px] text-muted-foreground bg-muted/40 border-t border-border">
            {current.rows.length} rows &times; {current.headers.length} columns
            {sheets.length > 1 && ` | Sheet: ${current.name}`}
          </div>
        </div>
      )}

      {current && current.headers.length === 0 && (
        <div className="flex items-center justify-center py-8">
          <p className="text-sm text-muted-foreground">Sheet &quot;{current.name}&quot; is empty</p>
        </div>
      )}
    </div>
  );
}
