// Returns the public subscription key used by this project's push sender.
Deno.serve(async (request: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "GET") return Response.json({ error: "GET required" }, { status: 405, headers });
  const key = (Deno.env.get("VAPID_PUBLIC_KEY") || "").trim().replace(/^["']|["']$/g, "").trim().replace(/=+$/, "");
  try {
    if (!/^[A-Za-z0-9_-]{87}$/.test(key)) throw new Error();
    const bytes = Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/") + "="), c => c.charCodeAt(0));
    if (bytes.length !== 65 || bytes[0] !== 4) throw new Error();
    await crypto.subtle.importKey("raw", bytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    return Response.json({ error: "Push configuration unavailable" }, { status: 503, headers });
  }
  return Response.json({ publicKey: key }, { headers });
});
