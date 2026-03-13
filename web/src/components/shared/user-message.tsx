"use client";

interface UserMessageProps {
  content: string;
  timestamp?: number;
}

export function UserMessage({ content }: UserMessageProps) {
  return (
    <div className="flex justify-end mb-6">
      <div className="max-w-[75%] rounded-2xl bg-muted px-4 py-3 text-sm text-foreground">
        <p className="whitespace-pre-wrap break-words leading-relaxed">{content}</p>
      </div>
    </div>
  );
}
