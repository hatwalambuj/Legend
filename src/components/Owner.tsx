'use client';
/**
 * Owner-only islands for public profile pages. Public HTML never reads the session cookie (API_CONTRACT
 * §1), so owner bits appear client-side once /api/me says the viewer is this handle.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/lib/api-client';
import type { PublicProfile, TitleSummary } from '@/lib/types';
import { useApp } from '@/hooks/useApp';
import { EmptyState } from './EmptyState';
import { Sheet, SheetButtons, SheetTitle } from './Sheet';
import { TicketGrid, GridSkeleton } from './TicketGrid';

export function useIsOwner(handle: string): boolean {
  const { session } = useApp();
  return session?.user.handle === handle;
}

export function OwnerSwitch({
  handle,
  owner,
  visitor,
}: {
  handle: string;
  owner: ReactNode;
  visitor: ReactNode;
}) {
  return <>{useIsOwner(handle) ? owner : visitor}</>;
}

export function OwnerOnly({ handle, children }: { handle: string; children: ReactNode }) {
  return useIsOwner(handle) ? <>{children}</> : null;
}

export function OwnerWatchlist({ handle }: { handle: string }) {
  const { session, sessionReady } = useApp();
  const owner = session?.user.handle === handle;
  const [items, setItems] = useState<TitleSummary[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!owner) return;
    let alive = true;
    api
      .watchlist()
      .then((p) => alive && setItems(p.items))
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, [owner]);

  if (!sessionReady) return <GridSkeleton count={5} />;
  if (!owner)
    return (
      <EmptyState title="This list is private">
        Only @{handle} can see their watchlist.
      </EmptyState>
    );
  if (error)
    return (
      <EmptyState title="The projector jammed">We couldn&apos;t load your watchlist.</EmptyState>
    );
  if (!items) return <GridSkeleton count={5} />;
  if (!items.length)
    return (
      <EmptyState
        title="Nothing saved"
        action={
          <Link href="/browse" className="btn btn--ghost">
            Browse titles
          </Link>
        }
      >
        Tap Watchlist on any title to save it for later.
      </EmptyState>
    );
  return <TicketGrid titles={items} label="Watchlist" />;
}

export function EditProfile({ profile }: { profile: PublicProfile }) {
  const owner = useIsOwner(profile.handle);
  const app = useApp();
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!owner) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Add a display name.');
    setBusy(true);
    try {
      await api.updateProfile({ displayName: name.trim(), bio: bio.trim() });
      setOpen(false);
      app.toast({ message: 'Profile saved' });
      router.refresh();
    } catch (err) {
      const ae = err instanceof ApiError ? err : null;
      setError(
        ae?.code === 'not_implemented'
          ? "Profile edits aren't switched on yet."
          : ae?.fields
            ? (Object.values(ae.fields)[0] ?? ae.message)
            : "Couldn't save your profile. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(true)}>
          Edit profile
        </button>
        <Link href="/me/stubs" className="btn btn--ghost btn--sm">
          My stubs
        </Link>
        <Link href="/me/settings" className="btn btn--ghost btn--sm">
          Settings
        </Link>
      </span>
      <Sheet open={open} onClose={() => setOpen(false)} labelledBy={`${uid}-h`}>
        <form onSubmit={save} noValidate>
          <SheetTitle id={`${uid}-h`}>Edit profile</SheetTitle>
          <div className="field">
            <label htmlFor={`${uid}-name`}>Display name</label>
            <input
              id={`${uid}-name`}
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-bio`}>Bio</label>
            <textarea
              id={`${uid}-bio`}
              value={bio}
              maxLength={160}
              onChange={(e) => setBio(e.target.value)}
              aria-describedby={`${uid}-bio-c`}
            />
            <span id={`${uid}-bio-c`} className="counter">
              {bio.length} / 160
            </span>
          </div>
          <div className="field">
            <span className="lbl">Handle</span>
            <span>@{profile.handle} · handles can&apos;t be changed</span>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <SheetButtons>
            <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary" disabled={busy}>
              Save
            </button>
          </SheetButtons>
        </form>
      </Sheet>
    </>
  );
}
