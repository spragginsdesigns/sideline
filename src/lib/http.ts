import { NextResponse } from "next/server";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(e: unknown, status = 400) {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[sideline] ${message}`);
  return NextResponse.json({ error: message }, { status });
}

export async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new Error("Expected a JSON body");
  }
}
