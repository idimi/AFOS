/**
 * Shared AFOS logo branding component.
 * Uses the icon (/afos-icon.png) + wordmark image cropped from the official logo.
 * 
 * Sizes:
 *  - "xs"  → icon 24px, wordmark h-3.5  (for very compact spots)
 *  - "sm"  → icon 28px, wordmark h-4    (sidebar collapsed-ish)
 *  - "md"  → icon 32px, wordmark h-5    (sidebar header, mobile drawer)
 *  - "lg"  → icon 40px, wordmark h-7    (landing navbar)
 *  - "xl"  → icon 48px, wordmark h-8    (landing footer, hero)
 */

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

const sizeMap: Record<LogoSize, { icon: string; wordmark: string; gap: string; ring: string; rounded: string }> = {
  xs: { icon: "w-6 h-6",   wordmark: "h-3.5", gap: "gap-1.5", ring: "ring-1 ring-border/30",  rounded: "rounded-md"  },
  sm: { icon: "w-7 h-7",   wordmark: "h-4",   gap: "gap-2",   ring: "ring-1 ring-border/40",  rounded: "rounded-lg"  },
  md: { icon: "w-8 h-8",   wordmark: "h-5",   gap: "gap-2.5", ring: "ring-1 ring-border/40",  rounded: "rounded-lg"  },
  lg: { icon: "w-10 h-10", wordmark: "h-7",   gap: "gap-2.5", ring: "ring-1 ring-white/10",   rounded: "rounded-xl"  },
  xl: { icon: "w-12 h-12", wordmark: "h-8",   gap: "gap-3",   ring: "ring-1 ring-white/10",   rounded: "rounded-xl"  },
};

export function AfosLogo({ size = "md", showWordmark = true, className = "", glow = false }: AfosLogoProps) {
  const s = sizeMap[size];

  return (
    <span className={`flex items-center ${s.gap} ${className}`}>
      <img
        src="/afos-icon.png"
        alt="AFOS"
        className={`${s.icon} ${s.rounded} shrink-0 object-contain ${s.ring} shadow-sm`}
        style={glow ? { filter: "drop-shadow(0 0 10px oklch(0.72 0.18 195 / 0.35))" } : undefined}
      />
      {showWordmark && (
        <img
          src={WORDMARK_URL}
          alt="AFOS"
          className={`${s.wordmark} object-contain shrink-0`}
          style={glow ? { filter: "drop-shadow(0 0 6px oklch(0.72 0.18 195 / 0.25))" } : undefined}
        />
      )}
    </span>
  );
}

export default AfosLogo;
