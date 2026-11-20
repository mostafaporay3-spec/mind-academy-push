const admin = require("firebase-admin");

function getFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT");
  let parsed;
  const trimmed = raw.trim();
  parsed = trimmed.startsWith("{")
    ? JSON.parse(trimmed)
    : JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  admin.initializeApp({ credential: admin.credential.cert(parsed) });
  return admin;
}

function getCairoDateStr() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

async function verifyCaller(req) {
  const admin = getFirebaseAdmin();
  const db = admin.firestore();
  const authHeader = req.headers.authorization || "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) {
    const err = new Error("Missing Authorization Bearer token");
    err.status = 401;
    throw err;
  }
  const decoded = await admin.auth().verifyIdToken(idToken);
  const uid = decoded.uid;
  const callerDoc = await db.collection("users").doc(uid).get();
  const callerData = callerDoc.exists ? callerDoc.data() : {};
  const isSuperAdmin =
    decoded.email === "mostafaporay3@gmail.com" && decoded.email_verified === true;
  const role = isSuperAdmin ? "admin" : (callerData.role || "parent");
  const isStaff = role === "admin" || role === "staff";
  const isBanned = callerData.banned === true && !isSuperAdmin;
  if (isBanned) {
    const err = new Error("Account is banned");
    err.status = 403;
    throw err;
  }
  return { admin, db, uid, decoded, callerData, role, isStaff, isSuperAdmin };
}

module.exports = { getFirebaseAdmin, getCairoDateStr, verifyCaller };
