const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");

/** PayPal caps invoice_number at 25 characters; keep the unique stamp and trim the readable middle. */
export function invoiceNumber(team: string, title: string, surname: string, stamp: string): string {
  const s = (x: string, n: number) => slug(x).replace(/-/g, "").slice(0, n);
  const tail = `-${stamp.slice(-5)}`;
  const head = `${s(team, 5)}-${s(title, 6)}-${s(surname, 7)}`;
  return `${head.slice(0, 25 - tail.length)}${tail}`;
}
