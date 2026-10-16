import type { SVGProps } from "react";
import { MicrophoneLine } from "@mingcute/react";

export default function LyricsIcon({
  size = 18,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return <MicrophoneLine size={size} className={className} {...(props as any)} />;
}
