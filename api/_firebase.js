const admin = require("firebase-admin");

function getFirebaseAdmin() {
  if (admin.apps.length > 0) return admin;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable");
  }

  let parsed;
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      parsed = JSON.parse(trimmed);
    } else {
      parsed = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
    }
  } catch (e) {
    throw new Error("Invalid FIREBASE_SERVICE_ACCOUNT JSON: " + e.message);
  }

  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }

  admin.initializeApp({
    credential: admin.credential.cert(parsed)
  });

  return admin;
}

module.exports = { getFirebaseAdmin };
