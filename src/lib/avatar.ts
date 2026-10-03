/**
 * Avatar colour choices (ADR-013 C-12, B3-AC2). Client-safe. `null` on a profile = the handle-derived
 * colour (today's behaviour). The gradients live in tokens.css (`--avatar-{key}-a/-b`). OWNER: Backend (C-00).
 */
import type { AvatarColor } from './types';

export type { AvatarColor };

export const AVATAR_COLORS = [
  'sunset',
  'ocean',
  'forest',
  'grape',
  'ember',
  'steel',
  'rose',
  'gold',
] as const satisfies readonly AvatarColor[];

/** Accessible names of the swatches ("Sunset" …). */
export const AVATAR_COLOR_LABELS: Record<AvatarColor, string> = {
  sunset: 'Sunset',
  ocean: 'Ocean',
  forest: 'Forest',
  grape: 'Grape',
  ember: 'Ember',
  steel: 'Steel',
  rose: 'Rose',
  gold: 'Gold',
};

export function isAvatarColor(v: unknown): v is AvatarColor {
  return typeof v === 'string' && (AVATAR_COLORS as readonly string[]).includes(v);
}
