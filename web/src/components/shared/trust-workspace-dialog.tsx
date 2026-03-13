"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";

interface TrustWorkspaceDialogProps {
  open: boolean;
  folderPath: string;
  onTrust: () => void;
  onCancel: () => void;
}

export function TrustWorkspaceDialog({
  open,
  folderPath,
  onTrust,
  onCancel,
}: TrustWorkspaceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-amber-500" />
            <DialogTitle>Trust this workspace?</DialogTitle>
          </div>
          <DialogDescription>
            <code className="mt-2 block rounded-md bg-muted px-3 py-2 text-xs font-mono text-foreground break-all">
              {folderPath}
            </code>
          </DialogDescription>
        </DialogHeader>

        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Trusting a workspace allows Claude to read, write, and execute
            commands within this directory. Only trust workspaces from sources
            you trust.
          </p>
          <p className="text-xs">
            <a
              href="https://docs.anthropic.com/en/docs/claude-code/security"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Learn more about workspace security
            </a>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onTrust}>Trust Workspace</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
