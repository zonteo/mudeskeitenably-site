// Fonction Netlify « /api/data » du site MUDESK
// Lecture « forte » : une modification enregistrée est visible tout de suite (sinon délai jusqu'à 60 s).
// Stocke les données du site (public + privé) et les vidéos dans Netlify Blobs.
import { getStore } from "@netlify/blobs";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const sc = promisify(scrypt);
const J = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// 1 = ok, 0 = mot de passe faux, -1 = ADMIN_PASSWORD non défini
async function auth(cfg, pw) {
  const st = await cfg.get("pw", { type: "json" }).catch(() => null);
  if (st && st.h) {
    const h = await sc(String(pw || ""), Buffer.from(st.s, "hex"), 32);
    return safeEq(h.toString("hex"), st.h) ? 1 : 0;
  }
  const env = process.env.ADMIN_PASSWORD;
  if (!env) return -1;
  return safeEq(pw || "", env) ? 1 : 0;
}


// Statistiques publiques : visiteurs en ligne, membres connectés, total des visites
async function hit(b) {
  const vid = String(b.vid || "");
  if (!/^[\w-]{8,64}$/.test(vid)) return J({ error: "identifiant invalide" }, 400);
  const sts = getStore({ name: "mudesk-stats", consistency: "strong" });
  const bk = Math.floor(Date.now() / 3e5); // tranches de 5 minutes
  await sts.set(`p/${bk}/${vid}`, "1");
  if (b.mem) await sts.set(`m/${bk}/${vid}`, "1");
  let c = await sts.get("visits", { type: "json" }).catch(() => null);
  let visits = (c && +c.n) || 0;
  if (b.visit) { visits += 1; await sts.setJSON("visits", { n: visits }); }
  const ids = async (pre) => {
    const r = await sts.list({ prefix: pre }).catch(() => ({ blobs: [] }));
    return r.blobs.map((x) => x.key.split("/")[2]);
  };
  const on = new Set([...(await ids(`p/${bk}/`)), ...(await ids(`p/${bk - 1}/`))]).size;
  const mem = new Set([...(await ids(`m/${bk}/`)), ...(await ids(`m/${bk - 1}/`))]).size;
  if (Math.random() < 0.1) { // nettoyage des anciennes tranches
    for (const pre of [`p/${bk - 2}/`, `m/${bk - 2}/`]) {
      const r = await sts.list({ prefix: pre }).catch(() => ({ blobs: [] }));
      for (const x of r.blobs) await sts.delete(x.key).catch(() => {});
    }
  }
  return J({ on, mem, visits });
}

export default async (req) => {
  const data = getStore({ name: "mudesk", consistency: "strong" });
  const vids = getStore("mudesk-videos");
  const cfg = getStore({ name: "mudesk-cfg", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const v = url.searchParams.get("video");
    if (v) {
      if (!/^[\w-]{6,64}$/.test(v)) return J({ error: "identifiant invalide" }, 400);
      const r = await vids.getWithMetadata(v, { type: "arrayBuffer" }).catch(() => null);
      if (!r || !r.data) return J({ error: "introuvable" }, 404);
      const buf = Buffer.from(r.data), size = buf.length;
      const base = {
        "content-type": (r.metadata && r.metadata.type) || "video/mp4",
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=86400",
      };
      const rg = req.headers.get("range");
      if (rg) {
        const m = /bytes=(\d*)-(\d*)/.exec(rg);
        const a = m && m[1] ? +m[1] : 0;
        let b = m && m[2] ? +m[2] : size - 1;
        if (a > b || a >= size)
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        b = Math.min(b, size - 1);
        return new Response(buf.subarray(a, b + 1), {
          status: 206,
          headers: { ...base, "content-range": `bytes ${a}-${b}/${size}`, "content-length": String(b - a + 1) },
        });
      }
      return new Response(buf, { headers: { ...base, "content-length": String(size) } });
    }
    const d = await data.get("data", { type: "json" }).catch(() => null);
    if (!d || !d.pub) return J({}, 404);
    const { pw, vault, ...pub } = d.pub; // jamais d'infos sensibles en public
    return J(pub);
  }

  if (req.method !== "POST") return J({ error: "méthode non autorisée" }, 405);
  let b;
  try { b = await req.json(); } catch { return J({ error: "requête invalide" }, 400); }

  if (b.action === "hit") return hit(b);

  const a = await auth(cfg, b.pw);
  if (a === -1) return J({ error: "ADMIN_PASSWORD n’est pas défini dans Netlify" }, 503);
  if (a === 0) return J({ error: "mot de passe incorrect" }, 401);

  switch (b.action) {
    case "login":
      return J({ ok: true });
    case "load": {
      const d = await data.get("data", { type: "json" }).catch(() => null);
      return J(d || { pub: null, priv: {}, t: 0 });
    }
    case "save":
      if (!b.pub || typeof b.pub !== "object") return J({ error: "données manquantes" }, 400);
      await data.setJSON("data", { pub: b.pub, priv: b.priv || {}, t: b.t || Date.now() });
      return J({ ok: true });
    case "vput": {
      if (!/^video\//.test(b.type || "")) return J({ error: "type de fichier non autorisé" }, 400);
      const buf = Buffer.from(String(b.b64 || ""), "base64");
      if (!buf.length || buf.length > 5 * 1024 * 1024) return J({ error: "vidéo vide ou trop lourde" }, 413);
      const id = randomBytes(9).toString("base64url");
      await vids.set(id, buf, { metadata: { type: b.type } });
      return J({ id });
    }
    case "vdel":
      if (/^[\w-]{6,64}$/.test(b.id || "")) await vids.delete(b.id).catch(() => {});
      return J({ ok: true });
    case "setpw": {
      const np = String(b.npw || "");
      if (np.length < 10) return J({ error: "10 caractères minimum" }, 400);
      const salt = randomBytes(16);
      const h = await sc(np, salt, 32);
      await cfg.setJSON("pw", { s: salt.toString("hex"), h: h.toString("hex") });
      return J({ ok: true });
    }
    default:
      return J({ error: "action inconnue" }, 400);
  }
};

export const config = { path: "/api/data" };
