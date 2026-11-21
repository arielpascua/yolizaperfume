import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container-page py-28 text-center">
      <p className="label-muted">404</p>
      <h1 className="mt-4 text-6xl italic">Nothing on this shelf.</h1>
      <p className="mx-auto mt-4 max-w-md text-lg text-ink-muted">The page you wanted is not here. The collection is.</p>
      <Link href="/collection" className="btn-primary mt-8">Browse the collection</Link>
    </div>
  );
}
