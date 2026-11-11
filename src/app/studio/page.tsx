"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { StudioTables } from "@/lib/studio/tables";

const StudioBoard = dynamic(() => import("@/components/studio/StudioBoard"), { ssr: false });

export default function StudioPage() {
  const [initial, setInitial] = useState<StudioTables | null>(null);
  useEffect(() => {
    void fetch("/api/state", { cache: "no-store" })
      .then(() => fetch("/api/studio/data", { cache: "no-store" }))
      .then((r) => r.json())
      .then(setInitial);
  }, []);
  return initial ? <StudioBoard initial={initial} /> : <div className="pitch h-dvh" />;
}
