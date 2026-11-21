'use client';

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="container-page py-28 text-center" role="alert">
      <p className="label-muted">Something went wrong</p>
      <h1 className="mt-4 text-5xl italic">A drop spilled.</h1>
      <p className="mx-auto mt-4 max-w-md text-lg text-ink-muted">Please try again. If it keeps happening, write to us.</p>
      <button type="button" onClick={reset} className="btn-primary mt-8">Try again</button>
    </div>
  );
}
