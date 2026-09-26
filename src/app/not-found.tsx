import Link from 'next/link';

// OWNER: Frontend. Placeholder 404 (DESIGN §7.9).
export default function NotFound() {
  return (
    <main className="wrap" style={{ paddingBlock: 96 }}>
      <h1>Wrong screen. This ticket doesn&apos;t exist.</h1>
      <Link href="/">Back to Discover</Link>
    </main>
  );
}
