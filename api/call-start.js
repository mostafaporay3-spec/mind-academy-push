const { verifyCaller, getCairoDateStr } = require("./_firebase");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  try {
    const { db, uid, callerData, isStaff } = await verifyCaller(req);
    const cairoDate = getCairoDateStr();

    const limitsDoc = await db.collection("settings").doc("limits").get();
    const limits = limitsDoc.exists ? limitsDoc.data() : {};

    if (!isStaff && limits.callsEnabled === false) {
      return res.status(403).json({ ok: false, error: "calls_disabled", message: "المكالمات الصوتية متوقفة حالياً" });
    }
    if (isStaff) {
      return res.status(200).json({ ok: true, unlimited: true, cairoDate });
    }
    if (callerData.status !== "approved") {
      return res.status(403).json({ ok: false, error: "not_approved" });
    }

    const defaultLimit = typeof limits.maxDailyCalls === "number" ? limits.maxDailyCalls : 5;
    const userLimit = typeof callerData.dailyCallLimit === "number" && callerData.dailyCallLimit > 0
      ? callerData.dailyCallLimit
      : defaultLimit;

    const limitRef = db.collection("call_limits").doc(`${uid}_${cairoDate}`);
    let used = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(limitRef);
      const cur = snap.exists ? (snap.data().count || 0) : 0;
      if (cur >= userLimit) {
        const err = new Error("limit_reached");
        err.status = 429;
        err.used = cur;
        throw err;
      }
      used = cur + 1;
      tx.set(limitRef, { uid, date: cairoDate, count: used, updatedAt: Date.now() }, { merge: true });
    });

    return res.status(200).json({
      ok: true,
      cairoDate,
      limit: userLimit,
      used,
      remaining: Math.max(0, userLimit - used)
    });
  } catch (err) {
    if (err.status === 429) {
      return res.status(429).json({
        ok: false,
        error: "limit_reached",
        message: "وصلت للحد اليومي للمكالمات. يمكنك التواصل عبر الشات أو حجز جلسة."
      });
    }
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }
};
