"use client";

import { Button } from "@/components/ui/button";
import { ExternalLink, FileText } from "lucide-react";

interface BinaryFallbackProps {
  ext: string;
  path: string;
  onOpenExternal: (path: string) => void;
}

export function BinaryFallback({ ext, path, onOpenExternal }: BinaryFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <FileText className="h-10 w-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">
        {ext.replace(".", "").toUpperCase()} files can&apos;t be previewed inline.
      </p>
      <Button variant="outline" size="sm" onClick={() => onOpenExternal(path)}>
        <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
        Open in default app
      </Button>
    </div>
  );
}
