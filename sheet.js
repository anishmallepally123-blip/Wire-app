/* Google Sheets backend.

   Talks to the Apps Script web app deployed against your team's sheet.
   text/plain keeps this a "simple request", so the browser never fires a
   CORS preflight that Apps Script can't answer. */
export async function callSheet(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Sheet returned ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Sheet rejected that request");
  return data.wires;
}
