"use client";

export function DropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-md pointer-events-none animate-in fade-in duration-150">
      <div className="flex flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-primary/60 bg-primary/5 px-16 py-12 animate-in zoom-in-95 duration-200">
        <div className="text-5xl animate-bounce">+</div>
        <p className="text-base font-medium text-foreground">Drop it like it&apos;s hot</p>
        <p className="text-xs text-muted-foreground">images, docs, code — we&apos;ll take it all</p>
      </div>
    </div>
  );
}
