import type { SVGProps } from "react";

export default function LyricsIcon({
  size = 18,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...props}
    >
      {/* 3 horizontal lyric lines */}
      <line x1="3.5" y1="6.5" x2="11.5" y2="6.5" />
      <line x1="3.5" y1="12" x2="9.5" y2="12" />
      <line x1="3.5" y1="17.5" x2="12.5" y2="17.5" />

      {/* Microphone */}
      <rect x="15" y="3" width="5" height="9" rx="2.5" />
      <path d="M13.5 8.5v1a4 4 0 0 0 8 0v-1" />
      <line x1="17.5" y1="13.5" x2="17.5" y2="17.5" />
      <line x1="15" y1="17.5" x2="20" y2="17.5" />
    </svg>
  );
}
