"use client";

import { useMemo } from "react";
import Papa from "papaparse";

interface CsvRendererProps {
  content: string;
}

export function CsvRenderer({ content }: CsvRendererProps) {
  const { headers, rows, error } = useMemo(() => {
    const result = Papa.parse<string[]>(content, {
      header: false,
      skipEmptyLines: true,
    });

    if (result.errors.length > 0 && result.data.length === 0) {
      return { headers: [], rows: [], error: result.errors[0].message };
    }

    const data = result.data;
    if (data.length === 0) {
      return { headers: [], rows: [], error: "File is empty" };
    }

    return {
      headers: data[0],
      rows: data.slice(1),
      error: null,
    };
  }, [content]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-muted-foreground">Failed to parse CSV: {error}</p>
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-xs font-mono">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
          <tr>
            {headers.map((h, i) => (
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
          {rows.map((row, ri) => (
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
        {rows.length} rows &times; {headers.length} columns
      </div>
    </div>
  );
}
