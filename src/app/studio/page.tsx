"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { StudioTables } from "@/lib/studio/tables";

const StudioBoard = dynamic(() => import("@/components/studio/StudioBoard"), { ssr: false });

export default function StudioPage() {
  const [initial, setInitial] = useState<StudioTables | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/studio/data", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as StudioTables & { error?: string };
      if (!res.ok || !Array.isArray(json.dues)) throw new Error(json.error ?? `The dashboard data did not load (${res.status}).`);
      setInitial(json);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (initial) return <StudioBoard initial={initial} />;
  return (
    <div className="pitch flex h-dvh flex-col items-center justify-center gap-4 text-chalk-dim">
      {error && (
        <>
          <p className="text-coral-soft">{error}</p>
          <button className="btn btn-primary" onClick={load}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}
