"use client";

interface ImageRendererProps {
  content: string;
  encoding: "utf-8" | "base64";
  ext: string;
  name: string;
}

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

export function ImageRenderer({ content, encoding, ext, name }: ImageRendererProps) {
  const src =
    encoding === "base64"
      ? `data:${EXT_TO_MIME[ext] || "image/png"};base64,${content}`
      : ext === ".svg"
        ? `data:image/svg+xml;utf8,${encodeURIComponent(content)}`
        : content;

  return (
    <div className="flex items-center justify-center p-4">
      <img
        src={src}
        alt={name}
        className="max-w-full max-h-[60vh] object-contain rounded-lg border border-border"
      />
    </div>
  );
}
