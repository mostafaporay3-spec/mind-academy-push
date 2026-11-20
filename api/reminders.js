const { getFirebaseAdmin } = require("./_firebase");

module.exports = async (req, res) => {
  const expected = (process.env.CRON_SECRET || "").trim();
  const provided = String(req.headers["x-cron-secret"] || req.query.secret || "").trim();
  if (!expected || provided !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const fcm = admin.messaging();

    const now = Date.now();
    const in24h = now + 24.5 * 60 * 60 * 1000;
    const snaps = await db.collection("sessions")
      .where("status", "==", "confirmed")
      .where("startAt", ">", now)
      .where("startAt", "<=", in24h)
      .get();

    let sent24 = 0;
    let sent1 = 0;

    for (const doc of snaps.docs) {
      const s = doc.data();
      if (!s.parentUid || !s.startAt) continue;
      const diffMs = s.startAt - now;
      const pDoc = await db.collection("users").doc(s.parentUid).get();
      const token = pDoc.exists ? pDoc.data().fcmToken : null;
      if (!token) continue;

      if (!s.reminded24h && diffMs <= 24.5 * 60 * 60 * 1000 && diffMs >= 22 * 60 * 60 * 1000) {
        await fcm.send({
          token,
          android: { priority: "high", notification: { channelId: "mind_bookings_ch" } },
          notification: {
            title: "تذكير بموعد الجلسة غداً",
            body: `موعد جلسة ${s.childName || "طفلك"}: ${s.date} الساعة ${s.time}`
          }
        });
        await doc.ref.update({ reminded24h: true });
        sent24++;
      }

      if (!s.reminded1h && diffMs <= 65 * 60 * 1000 && diffMs >= 45 * 60 * 1000) {
        await fcm.send({
          token,
          android: { priority: "high", ttl: 600000 },
          data: {
            type: "reminder_1h",
            body: `عندك ميعاد جلسة بعد ساعة (${s.time}) للطفل ${s.childName || ""}`
          }
        });
        await doc.ref.update({ reminded1h: true });
        sent1++;
      }
    }

    let purgedArchives = 0;
    const expiredSnap = await db.collection("archived_parents")
      .where("expiresAt", "<=", now)
      .get();
    for (const doc of expiredSnap.docs) {
      await doc.ref.delete();
      purgedArchives++;
    }

    // Auto-purge chat_sessions older than 7 days (including messages subcollection)
    let purgedChats = 0;
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const allChatSess = await db.collection("chat_sessions").get();
    for (const doc of allChatSess.docs) {
      const data = doc.data();
      const exp = typeof data.expiresAt === "number" && data.expiresAt > 0
        ? data.expiresAt
        : ((data.closedAt || data.openedAt || 0) + (7 * 24 * 60 * 60 * 1000));
      if (exp <= now || (data.openedAt && data.openedAt < sevenDaysAgo && !data.expiresAt)) {
        const msgs = await doc.ref.collection("messages").get();
        const batch = db.batch();
        for (const m of msgs.docs) batch.delete(m.ref);
        batch.delete(doc.ref);
        await batch.commit();
        purgedChats++;
      }
    }

    return res.status(200).json({ ok: true, sent24, sent1, purgedArchives, purgedChats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
