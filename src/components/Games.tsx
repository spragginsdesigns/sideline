"use client";
import { useState } from "react";
import { CheckCircle2, Clock, Whistle } from "lucide-react";
import type { DashboardView } from "@/lib/view";
import { api } from "@/hooks/useDashboard";
import { Spinner, money, shortDate } from "./ui";

type Game = DashboardView["games"][number];

export function Games({ data, onError }: { data: DashboardView; onError: (msg: string) => void }) {
  const today = new Date().toDateString();
  const games = [...data.games].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <ul className="flex flex-col gap-3">
      {games.map((g) => (
        <GameRow key={g.id} game={g} data={data} isToday={new Date(g.date).toDateString() === today} onError={onError} />
      ))}
    </ul>
  );
}

function GameRow({ game, data, isToday, onError }: { game: Game; data: DashboardView; isToday: boolean; onError: (m: string) => void }) {
  const ref = data.team.referees.find((r) => r.id === game.refereeId)!;
  const [us, setUs] = useState("");
  const [them, setThem] = useState("");
  const [busy, setBusy] = useState(false);
  // Same window finalizeGame() accepts, so the form never offers a payout the server refuses.
  const past = new Date(game.date).getTime() <= Date.now() + 3 * 3600_000;

  async function finalize() {
    setBusy(true);
    try {
      await api(`/api/games/${game.id}/final`, { us: Number(us), them: Number(them) });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const result = game.score ? (game.score.us > game.score.them ? "W" : game.score.us < game.score.them ? "L" : "D") : null;

  return (
    <li className={`rounded-lg border p-3 ${isToday && game.status !== "final" ? "border-led/40 bg-led/[0.04]" : "border-chalk/10 bg-night-950/40"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isToday && game.status !== "final" && <span className="pill pill-sent">Today</span>}
            <span className="truncate font-semibold">vs {game.opponent}</span>
          </div>
          <div className="mt-0.5 text-xs text-chalk-faint">
            {shortDate(game.date)} · {game.field}
          </div>
        </div>
        {game.score && (
          <div className="text-right">
            <div className="led text-xl font-bold">
              {game.score.us}–{game.score.them}
            </div>
            <div className={`text-xs font-semibold ${result === "W" ? "text-turf-bright" : result === "L" ? "text-coral-soft" : "text-chalk-dim"}`}>{result === "W" ? "WIN" : result === "L" ? "LOSS" : "DRAW"}</div>
          </div>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 text-chalk-dim">
          <Whistle size={15} /> {ref.name} · {money(ref.feeCents)}
        </span>
        {game.payout?.status === "SUCCESS" && (
          <span className="flex items-center gap-1 text-turf-bright">
            <CheckCircle2 size={15} /> Paid via PayPal Payouts
          </span>
        )}
        {game.payout?.status === "PENDING" && (
          <span className="flex items-center gap-1.5 text-led-bright">
            <Spinner /> Payout processing…
          </span>
        )}
        {game.payout?.status === "UNCLAIMED" && (
          <span className="flex items-center gap-1 text-led-bright" title="PayPal sent it; the ref gets an email to claim it">
            <CheckCircle2 size={15} /> Sent via PayPal Payouts · ref claims by email
          </span>
        )}
        {game.payout?.status === "FAILED" && <span className="text-coral-soft">Payout failed</span>}
        {!game.payout && !past && (
          <span className="flex items-center gap-1 text-chalk-faint">
            <Clock size={14} /> Pays out when final
          </span>
        )}
      </div>
      {!game.payout && past && (
        <div className="mt-3 flex items-center gap-2">
          <label className="sr-only" htmlFor={`us-${game.id}`}>
            {data.team.shortName} score
          </label>
          <input id={`us-${game.id}`} className="field !w-[4.75rem] !px-2 !py-2 text-center led" inputMode="numeric" placeholder="Us" value={us} onChange={(e) => setUs(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <span className="text-chalk-faint">–</span>
          <label className="sr-only" htmlFor={`them-${game.id}`}>
            {game.opponent} score
          </label>
          <input id={`them-${game.id}`} className="field !w-[4.75rem] !px-2 !py-2 text-center led" inputMode="numeric" placeholder="Them" value={them} onChange={(e) => setThem(e.target.value.replace(/\D/g, "").slice(0, 2))} />
          <button className="btn btn-primary flex-1" disabled={busy || us === "" || them === ""} onClick={finalize}>
            {busy ? <Spinner /> : <Whistle size={16} />} Final · pay ref
          </button>
        </div>
      )}
    </li>
  );
}
