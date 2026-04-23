import React from "react";

export function EchoMindLogo({
  className = "w-8 h-8",
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      {...props}
    >
      {/* 记忆波谱 (Memory Spectrum) - 递增的声波形柱状图，暗示声音、积累与回想 */}
      <rect x="20" y="40" width="12" height="20" rx="6" fill="currentColor" opacity="0.3" />
      <rect x="38" y="25" width="12" height="50" rx="6" fill="currentColor" opacity="0.5" />
      <rect x="56" y="10" width="12" height="80" rx="6" fill="currentColor" opacity="0.8" />
      <rect x="74" y="30" width="12" height="40" rx="6" fill="currentColor" opacity="1.0" />
    </svg>
  );
}
