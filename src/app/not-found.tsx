import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-12 text-foreground">
      <section className="w-full max-w-md rounded-3xl border border-border bg-surface p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">404</p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight">That page has no pulse</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Return to the measurement screen to start a reading.
        </p>
        <Link className="button-primary mt-6 w-full" href="/">
          Back to PulsePrint
        </Link>
      </section>
    </main>
  );
}
