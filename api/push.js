const { getFirebaseAdmin } = require("./_firebase");

async function getStaffTokens(db, excludeUid) {
  const snap = await db.collection("users").where("role", "in", ["admin", "staff"]).get();
  return snap.docs
    .filter((d) => d.id !== excludeUid && d.data().banned !== true && d.data().fcmToken)
    .map((d) => d.data().fcmToken);
}

async function getParentToken(db, parentUid) {
  if (!parentUid) return [];
  const doc = await db.collection("users").doc(parentUid).get();
  if (doc.exists && doc.data().banned !== true && doc.data().fcmToken) {
    return [doc.data().fcmToken];
  }
  return [];
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();
    const fcm = admin.messaging();

    // 1. Verify Firebase Auth ID Token
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!idToken) {
      return res.status(401).json({ error: "Missing Authorization Bearer token" });
    }

    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // 2. Load caller profile from Firestore
    const callerDoc = await db.collection("users").doc(uid).get();
    const callerData = callerDoc.exists ? callerDoc.data() : {};
    const isSuperAdmin =
      decoded.email === "mostafaporay3@gmail.com" && decoded.email_verified === true;
    const role = isSuperAdmin ? "admin" : (callerData.role || "parent");
    const isStaff = role === "admin" || role === "staff";
    const isBanned = callerData.banned === true && !isSuperAdmin;

    if (isBanned) {
      return res.status(403).json({ error: "Account is banned" });
    }
    if (!isStaff && callerData.status !== "approved") {
      return res.status(403).json({ error: "Account not approved" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const type = String(body.type || "");

    // 3. Dispatch Push Notification by Event Type
    if (type === "call_ring") {
      const callId = String(body.callId || "");
      const parentUid = String(body.parentUid || "");
      const callerName = String(body.callerName || "Mind Academy");
      const callerRole = isStaff ? role : "parent";
      if (!callId) return res.status(400).json({ error: "Missing callId" });

      const tokens =
        callerRole === "parent"
          ? await getStaffTokens(db, uid)
          : await getParentToken(db, parentUid);

      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });

      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", ttl: 30000 },
        data: {
          type: "incoming_call",
          callId,
          parentUid,
          callerName,
          createdAt: String(Date.now())
        }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "call_cancelled") {
      const callId = String(body.callId || "");
      const parentUid = String(body.parentUid || "");
      const callerRole = String(body.callerRole || (isStaff ? role : "parent"));
      if (!callId) return res.status(400).json({ error: "Missing callId" });

      let tokens = [];
      if (callerRole === "parent") {
        tokens = await getStaffTokens(db, uid);
      } else {
        tokens = await getParentToken(db, parentUid);
      }
      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });

      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", ttl: 15000 },
        data: { type: "call_cancelled", callId }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "chat_msg") {
      const parentUid = String(body.parentUid || "");
      const senderName = String(body.senderName || "Mind Academy");
      const text = String(body.text || "");
      const senderRole = isStaff ? role : "parent";

      const tokens =
        senderRole === "parent"
          ? await getStaffTokens(db, uid)
          : await getParentToken(db, parentUid);

      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });

      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", notification: { channelId: "mind_chat_ch" } },
        notification: {
          title: `رسالة جديدة من ${senderName}`,
          body: text
        },
        data: { type: "chat", parentUid }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "announcement") {
      if (role !== "admin") {
        return res.status(403).json({ error: "Only admin can send announcements" });
      }
      const target = String(body.target || "all");
      const text = String(body.text || "");
      const topic =
        target === "parent" ? "role_parent" :
        target === "staff" ? "role_staff" : "all_users";

      await fcm.send({
        topic,
        android: { priority: "high" },
        data: {
          type: "announcement",
          title: "إعلان من Mind Academy",
          body: text
        }
      });
      return res.status(200).json({ ok: true, topic });
    }

    if (type === "session_update") {
      const parentUid = String(body.parentUid || "");
      const childName = String(body.childName || "ولي أمر");
      const date = String(body.date || "");
      const time = String(body.time || "");
      const status = String(body.status || "");

      if (status === "cancelled") {
        const tokens = await getStaffTokens(db, uid);
        if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
        const result = await fcm.sendEachForMulticast({
          tokens,
          android: { priority: "high", notification: { channelId: "mind_bookings_ch" } },
          notification: {
            title: "تم إلغاء موعد جلسة",
            body: `${childName} ألغى موعد ${date} الساعة ${time}`
          }
        });
        return res.status(200).json({ ok: true, sent: result.successCount });
      }

      if ((status === "confirmed" || status === "rejected") && isStaff) {
        const tokens = await getParentToken(db, parentUid);
        if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
        const title = status === "confirmed" ? "تم تأكيد موعد الجلسة" : "تم رفض طلب الجلسة";
        const result = await fcm.sendEachForMulticast({
          tokens,
          android: { priority: "high", notification: { channelId: "mind_bookings_ch" } },
          notification: { title, body: `التاريخ: ${date} — الساعة: ${time}` }
        });
        return res.status(200).json({ ok: true, sent: result.successCount });
      }
      return res.status(200).json({ ok: true, sent: 0 });
    }

    return res.status(400).json({ error: "Unknown push type" });
  } catch (err) {
    console.error("Push error:", err);
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
};
