/**
 * Gradient-initials avatar (DESIGN §6). A chosen colour (ADR-013 C-12) uses the `--avatar-{key}-a/-b`
 * tokens; null = colours hashed from the handle. Ink initials on top.
 */
import type { AvatarColor } from '@/lib/types';
import { avatarColors, initials } from './lib/display';
import styles from './Avatar.module.css';

export function Avatar({
  handle,
  name,
  color = null,
  size = 36,
  className = '',
}: {
  handle: string;
  name: string;
  color?: AvatarColor | null;
  size?: number;
  className?: string;
}) {
  const [a, b] = color
    ? [`var(--avatar-${color}-a)`, `var(--avatar-${color}-b)`]
    : avatarColors(handle);
  return (
    <span
      className={`${styles.avatar} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.38),
        backgroundImage: `linear-gradient(135deg, ${a}, ${b})`,
      }}
      aria-hidden="true"
      data-avatar-color={color ?? undefined}
    >
      {initials(name || handle).slice(0, size >= 60 ? 2 : 1)}
    </span>
  );
}
