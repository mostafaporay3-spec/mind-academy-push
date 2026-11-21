const { verifyCaller, getCairoDateStr } = require("./_firebase");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  try {
    const { db, uid, isStaff } = await verifyCaller(req);
    if (isStaff) return res.status(200).json({ ok: true });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const callId = String(body.callId || "");
    if (!callId) return res.status(400).json({ error: "Missing callId" });

    const callRef = db.collection("calls").doc(callId);
    const cairoDate = getCairoDateStr();
    const limitRef = db.collection("call_limits").doc(`${uid}_${cairoDate}`);

    await db.runTransaction(async (tx) => {
      const cSnap = await tx.get(callRef);
      if (!cSnap.exists) return;
      const c = cSnap.data();
      if (c.callerUid !== uid || c.answeredByUid || c.refunded) return;
      const lSnap = await tx.get(limitRef);
      if (lSnap.exists) {
        const cur = lSnap.data().count || 0;
        tx.update(limitRef, { count: Math.max(0, cur - 1) });
      }
      tx.update(callRef, { refunded: true });
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
