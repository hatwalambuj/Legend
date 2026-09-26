/** Gradient-initials avatar (DESIGN §6). Colours hash from the handle; ink initials on top. */
import { avatarColors, initials } from './lib/display';
import styles from './Avatar.module.css';

export function Avatar({
  handle,
  name,
  size = 36,
  className = '',
}: {
  handle: string;
  name: string;
  size?: number;
  className?: string;
}) {
  const [a, b] = avatarColors(handle);
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
    >
      {initials(name || handle).slice(0, size >= 60 ? 2 : 1)}
    </span>
  );
}
