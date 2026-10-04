/** Profile tab skeleton (ADR-013 C-03): the Suspense fallback under the server-rendered profile header. */
import sk from './Skeleton.module.css';
import { WalletSkeleton } from './WalletStub';

export function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" data-testid="profile-skeleton">
      <span className={sk.bar} style={{ width: '25%', marginBottom: 20, display: 'block' }} />
      <WalletSkeleton count={8} />
    </div>
  );
}
