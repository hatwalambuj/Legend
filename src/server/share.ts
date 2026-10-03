/**
 * Who may be shared (ADR-013 C-08). Today every existing profile is public-read (ADR-005), so this is
 * `true`. A future private-profile flag changes only this function; the stub share landing, OG image
 * and story routes all go through `dal.getStubShare`, which calls it. Nothing else does. OWNER: Backend.
 */
import type { PublicProfile } from '@/lib/types';

export function isProfileShareable(profile: PublicProfile | null | undefined): boolean {
  return Boolean(profile);
}
