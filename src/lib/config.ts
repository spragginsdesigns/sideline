export function publicBaseUrl(): string {
  const explicit = process.env.SIDELINE_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const port = process.env.PORT || "3000";
  return `http://localhost:${port}`;
}

export const AI_MODEL = process.env.SIDELINE_MODEL || "gpt-5.6-luna";

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
