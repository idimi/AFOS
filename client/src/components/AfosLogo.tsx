/**
 * Shared AFOS logo branding component.
 * Uses the icon (/afos-icon.png) + wordmark image cropped from the official logo.
 *
 * To remove BETA badges across the entire app, flip `IS_BETA` to false in shared/const.ts.
 *
 * Sizes:
 *  - "xs"  → icon 24px, wordmark h-3.5  (very compact spots)
 *  - "sm"  → icon 28px, wordmark h-4    (sidebar collapsed)
 *  - "md"  → icon 32px, wordmark h-5    (sidebar header, mobile drawer)
 *  - "lg"  → icon 40px, wordmark h-7    (landing navbar)
 *  - "xl"  → icon 48px, wordmark h-8    (landing footer, hero)
 */

import { IS_BETA } from "@shared/const";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const WORDMARK_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/87744282/Cv4Jvx35N7jGsqrM8y5HAD/afos-wordmark-clean_83ee0809.png";

type LogoSize = "xs" | "sm" | "md" | "lg" | "xl";

interface AfosLogoProps {
  size?: LogoSize;
  /** Show the wordmark text image next to the icon */
  showWordmark?: boolean;
  /** Extra className on the wrapper */
  className?: string;
  /** Glow effect on the icon (landing page style) */
  glow?: boolean;
}

const sizeMap: Record<
  LogoSize,
  { icon: string; wordmark: string; gap: string; ring: string; rounded: string; badge: string; badgeOffset: string }
> = {
  xs: { icon: "w-6 h-6",   wordmark: "h-3.5", gap: "gap-1.5", ring: "ring-1 ring-border/30", rounded: "rounded-md",  badge: "text-[6px] px-0.5 py-px",  badgeOffset: "-top-2 -right-5"  },
  sm: { icon: "w-7 h-7",   wordmark: "h-4",   gap: "gap-2",   ring: "ring-1 ring-border/40", rounded: "rounded-lg",  badge: "text-[7px] px-1 py-px",    badgeOffset: "-top-2 -right-6"  },
  md: { icon: "w-8 h-8",   wordmark: "h-5",   gap: "gap-2.5", ring: "ring-1 ring-border/40", rounded: "rounded-lg",  badge: "text-[7px] px-1 py-px",    badgeOffset: "-top-2 -right-6"  },
  lg: { icon: "w-10 h-10", wordmark: "h-7",   gap: "gap-2.5", ring: "ring-1 ring-white/10",  rounded: "rounded-xl",  badge: "text-[8px] px-1 py-0.5",   badgeOffset: "-top-2.5 -right-7"},
  xl: { icon: "w-12 h-12", wordmark: "h-8",   gap: "gap-3",   ring: "ring-1 ring-white/10",  rounded: "rounded-xl",  badge: "text-[9px] px-1.5 py-0.5", badgeOffset: "-top-3 -right-8"  },
};

export function AfosLogo({ size = "md", showWordmark = true, className = "", glow = false }: AfosLogoProps) {
  const s = sizeMap[size];
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  // In light mode the wordmark PNG (white text on transparent) is nearly invisible.
  // Apply invert + hue-rotate to turn it into a dark navy/slate colour that reads well
  // on a white background, while keeping the cyan accent tint.
  const isLight = mounted && resolvedTheme === "light";
  const wordmarkFilter = isLight
    ? "invert(1) hue-rotate(180deg) brightness(0.15) saturate(1.4)"
    : glow
    ? "drop-shadow(0 0 6px oklch(0.72 0.18 195 / 0.25))"
    : undefined;

  return (
    <>
      {/* Keyframe styles injected once — safe to repeat, browser deduplicates */}
      <style>{`
        @keyframes afos-beta-pulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 0 0 oklch(0.72 0.18 195 / 0.5); }
          50%       { opacity: 0.85; box-shadow: 0 0 0 3px oklch(0.72 0.18 195 / 0); }
        }
        @keyframes afos-beta-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .afos-beta-badge {
          animation: afos-beta-pulse 2.4s ease-in-out infinite;
          background: linear-gradient(
            90deg,
            oklch(0.72 0.18 195 / 0.18) 0%,
            oklch(0.72 0.18 195 / 0.35) 40%,
            oklch(0.85 0.14 195 / 0.55) 50%,
            oklch(0.72 0.18 195 / 0.35) 60%,
            oklch(0.72 0.18 195 / 0.18) 100%
          );
          background-size: 200% auto;
          animation: afos-beta-pulse 2.4s ease-in-out infinite,
                     afos-beta-shimmer 3s linear infinite;
        }
      `}</style>

      <span className={`flex items-center ${s.gap} ${className}`}>
        <img
          src="/afos-icon.png"
          alt="AFOS"
          className={`${s.icon} ${s.rounded} shrink-0 object-contain ${s.ring} shadow-sm`}
          style={glow ? { filter: "drop-shadow(0 0 10px oklch(0.72 0.18 195 / 0.35))" } : undefined}
        />
        {showWordmark && (
          <span className="relative inline-flex items-center">
            <img
              src={WORDMARK_URL}
              alt="AFOS"
              className={`${s.wordmark} object-contain shrink-0`}
              style={{ filter: wordmarkFilter }}
            />
            {IS_BETA && (
              <span
                className={`afos-beta-badge absolute ${s.badgeOffset} ${s.badge} font-black tracking-widest rounded`}
                style={{
                  border: "1px solid oklch(0.72 0.18 195 / 0.55)",
                  color: isLight ? "oklch(0.35 0.18 195)" : "oklch(0.72 0.18 195)",
                  lineHeight: 1,
                  letterSpacing: "0.12em",
                }}
              >
                BETA
              </span>
            )}
          </span>
        )}
      </span>
    </>
  );
}

export default AfosLogo;
