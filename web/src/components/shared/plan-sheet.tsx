"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { MarkdownRenderer } from "./markdown-renderer";
import { ListChecks, X } from "lucide-react";

interface PlanSheetProps {
  content: string | undefined;
  open: boolean;
  onClose: () => void;
}

export function PlanSheet({ content, open, onClose }: PlanSheetProps) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="overflow-hidden flex flex-col p-0"
        style={{ width: 480 }}
      >
        <SheetHeader className="shrink-0 pl-5 pr-4 pt-4 pb-2 border-b border-border/50">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary shrink-0" />
            <SheetTitle className="truncate text-sm flex-1">Plan</SheetTitle>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <SheetDescription className="sr-only">
            Current plan created by Claude
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-5 py-4">
            {content ? (
              <MarkdownRenderer content={content} />
            ) : (
              <p className="text-sm text-muted-foreground">No plan available.</p>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
