import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

interface Props {
  filename: string;
  className?: string;
  alt?: string;
}

export default function ThoughtImage({ filename, className, alt = "想法图片" }: Props) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invoke<string>("get_image_path", { filename })
      .then((fullPath) => {
        if (!cancelled) {
          setSrc(convertFileSrc(fullPath));
        }
      })
      .catch(() => {
        // Fallback: try HTTP server
        if (!cancelled) {
          setSrc(`http://127.0.0.1:8765/api/images/${filename}`);
        }
      });

    return () => { cancelled = true; };
  }, [filename]);

  if (!src) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
    />
  );
}
