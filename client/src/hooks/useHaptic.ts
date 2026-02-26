/**
 * useHaptic — Web Vibration API wrapper
 * Provides haptic feedback on supported mobile devices (Android Chrome).
 * Silently no-ops on unsupported devices (iOS, desktop).
 */

export function useHaptic() {
  const vibrate = (pattern: number | number[] = 40) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        // Silently ignore — not all browsers support vibrate
      }
    }
  };

  const tap = () => vibrate(40);
  const success = () => vibrate([40, 30, 80]);
  const error = () => vibrate([80, 40, 80, 40, 80]);
  const light = () => vibrate(20);

  return { tap, success, error, light, vibrate };
}
