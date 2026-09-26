import { WalletSkeleton } from '@/components/WalletStub';
import sk from '@/components/Skeleton.module.css';

export default function Loading() {
  return (
    <div className="wrap" aria-busy="true" aria-label="Loading profile">
      <div style={{ padding: '56px 0 32px', display: 'grid', gap: 14 }}>
        <span className={sk.bar} style={{ width: 84, height: 84, borderRadius: '50%' }} />
        <span className={sk.bar} style={{ width: '40%', height: 48 }} />
        <span className={sk.bar} style={{ width: '25%' }} />
      </div>
      <WalletSkeleton count={8} />
    </div>
  );
}
