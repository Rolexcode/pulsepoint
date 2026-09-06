"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-12 text-foreground">
      <section className="w-full max-w-md rounded-3xl border border-border bg-surface p-6 text-center">
        <AlertTriangle className="mx-auto size-9 text-warning" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold tracking-tight">PulsePrint needs a restart</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Your saved readings are still on this device. Restart the screen and try again.
        </p>
        <button className="button-primary mt-6 w-full" type="button" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Restart screen
        </button>
      </section>
    </main>
  );
}
