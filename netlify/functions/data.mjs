import admin from 'firebase-admin';
let app;
function getApp(){
  if(app) return app;
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  app = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return app;
}
export default async (req) => {
  try {
    const db = getApp().firestore();
    const siteSnap = await db.collection('site').get();
    const adminSnap = await db.collection('admin').limit(1).get();
    const siteData = {};
    siteSnap.forEach(doc => siteData[doc.id] = doc.data());
    let adminEmail = adminSnap.empty ? null : adminSnap.docs[0].data().email;
    return new Response(JSON.stringify({ ok: true, site: siteData, adminConfigured: !!adminEmail, adminEmail }), { status: 200, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
