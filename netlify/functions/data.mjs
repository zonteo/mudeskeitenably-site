import { getStore } from "@netlify/blobs";
import { createHash, timingSafeEqual, scryptSync, randomBytes } from "node:crypto";

export const config = { path: "/api/data" };

const J = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const hs = (p, salt) => scryptSync(p, salt, 32);
const sha = (x) => createHash("sha256").update(x).digest();
const vs = () => getStore("mudesk-videos");
const VID = /^[a-f0-9]{16}$/;

// Lecture d'une vidéo courte (avec prise en charge des requêtes Range, requise par Safari / iPhone)
async function video(req, id) {
  if (!VID.test(id)) return J({ error: "identifiant invalide" }, 400);
  const s = vs();
  const buf = await s.get(id, { type: "arrayBuffer" });
  if (!buf) return J({ error: "vidéo introuvable" }, 404);
  const m = await s.get("meta_" + id, { type: "json" });
  const n = buf.byteLength;
  const h = { "content-type": (m && m.type) || "video/mp4", "accept-ranges": "bytes", "cache-control": "public, max-age=86400" };
  const mm = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "");
  if (mm) {
    const a = mm[1] === "" ? Math.max(0, n - Number(mm[2])) : Number(mm[1]);
    const z = mm[1] === "" || mm[2] === "" ? n - 1 : Math.min(Number(mm[2]), n - 1);
    if (a > z || a >= n) return new Response(null, { status: 416, headers: { "content-range": "bytes */" + n } });
    return new Response(buf.slice(a, z + 1), { status: 206, headers: { ...h, "content-range": `bytes ${a}-${z}/${n}`, "content-length": String(z - a + 1) } });
  }
  return new Response(buf, { headers: { ...h, "content-length": String(n) } });
}

// true / false ; null si aucun mot de passe n'est configuré
async function check(pw, store) {
  const a = await store.get("auth", { type: "json" });
  if (a) return timingSafeEqual(hs(pw, Buffer.from(a.s, "hex")), Buffer.from(a.h, "hex"));
  const e = process.env.ADMIN_PASSWORD;
  if (!e) return null;
  return timingSafeEqual(sha(pw), sha(e));
}

export default async (req) => {
  const s = getStore("mudesk");
  if (req.method === "GET") {
    const vid = new URL(req.url).searchParams.get("video");
    if (vid) return video(req, vid);
    return J((await s.get("public", { type: "json" })) || {});
  }
  if (req.method !== "POST") return J({ error: "méthode non autorisée" }, 405);
  let b;
  try { b = await req.json(); } catch { return J({ error: "requête invalide" }, 400); }
  const ok = await check(String(b.pw || ""), s);
  if (ok === null) return J({ error: "ADMIN_PASSWORD n'est pas défini dans Netlify" }, 503);
  if (!ok) return J({ error: "mot de passe incorrect" }, 401);
  if (b.action === "login") return J({ ok: true });
  if (b.action === "load") {
    const [pub, priv, meta] = await Promise.all([
      s.get("public", { type: "json" }), s.get("private", { type: "json" }), s.get("meta", { type: "json" })]);
    return J({ pub, priv, t: (meta && meta.t) || 0 });
  }
  if (b.action === "save") {
    const { pw: _p, vault: _v, ...pub } = b.pub || {};
    await s.setJSON("public", pub);
    await s.setJSON("private", b.priv || {});
    await s.setJSON("meta", { t: Number(b.t) || Date.now() });
    return J({ ok: true });
  }
  if (b.action === "vput") {
    const raw = Buffer.from(String(b.b64 || ""), "base64");
    if (!/^video\//.test(String(b.type || "")) || !raw.length || raw.length > 4.5e6)
      return J({ error: "vidéo invalide ou trop lourde (4 Mo maximum)" }, 400);
    const id = randomBytes(8).toString("hex"), v = vs();
    await v.set(id, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    await v.setJSON("meta_" + id, { type: String(b.type) });
    return J({ id });
  }
  if (b.action === "vdel") {
    const id = String(b.id || "");
    if (VID.test(id)) { const v = vs(); await v.delete(id); await v.delete("meta_" + id); }
    return J({ ok: true });
  }
  if (b.action === "setpw") {
    if (String(b.npw || "").length < 10) return J({ error: "mot de passe trop court (10 caractères minimum)" }, 400);
    const salt = randomBytes(16);
    await s.setJSON("auth", { s: salt.toString("hex"), h: hs(String(b.npw), salt).toString("hex") });
    return J({ ok: true });
  }
  return J({ error: "action inconnue" }, 400);
};
