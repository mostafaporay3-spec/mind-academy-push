const { verifyCaller } = require("./_firebase");

async function getStaffTokens(db, excludeUid) {
  const snap = await db.collection("users").where("role", "in", ["admin", "staff"]).get();
  return snap.docs
    .filter((d) => d.id !== excludeUid && d.data().banned !== true && d.data().fcmToken)
    .map((d) => d.data().fcmToken);
}

async function getUserToken(db, uid) {
  if (!uid) return [];
  const doc = await db.collection("users").doc(uid).get();
  if (doc.exists && doc.data().banned !== true && doc.data().fcmToken) {
    return [doc.data().fcmToken];
  }
  return [];
}

function clampText(str, maxLen = 300) {
  return String(str || "").trim().slice(0, maxLen);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  try {
    const { admin, db, uid, callerData, role, isStaff } = await verifyCaller(req);
    if (!isStaff && callerData.status !== "approved") {
      return res.status(403).json({ error: "Account not approved" });
    }

    const fcm = admin.messaging();
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const type = String(body.type || "");
    const trustedName = clampText(
      callerData.motherName || callerData.childName || (isStaff ? "فريق Mind Academy" : "ولي أمر"),
      80
    );

    if (type === "call_ring") {
      const callId = clampText(body.callId, 100);
      if (!callId) return res.status(400).json({ error: "Missing callId" });
      const callDoc = await db.collection("calls").doc(callId).get();
      if (!callDoc.exists) return res.status(404).json({ error: "Call not found" });
      const call = callDoc.data();
      if (call.callerUid !== uid) return res.status(403).json({ error: "Not call owner" });

      const parentUid = String(call.parentUid || "");
      const tokens = isStaff
        ? await getUserToken(db, parentUid)
        : await getStaffTokens(db, uid);

      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", ttl: 30000 },
        data: {
          type: "incoming_call",
          callId,
          parentUid,
          callerName: trustedName,
          createdAt: String(Date.now())
        }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "call_cancelled") {
      const callId = clampText(body.callId, 100);
      if (!callId) return res.status(400).json({ error: "Missing callId" });
      const callDoc = await db.collection("calls").doc(callId).get();
      const parentUid = callDoc.exists ? String(callDoc.data().parentUid || "") : String(body.parentUid || "");
      const callerRole = callDoc.exists ? String(callDoc.data().callerRole || "parent") : String(body.callerRole || "parent");

      const tokens = callerRole === "parent"
        ? await getStaffTokens(db, uid)
        : await getUserToken(db, parentUid);

      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", ttl: 15000 },
        data: { type: "call_cancelled", callId }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "chat_msg") {
      const parentUid = isStaff ? clampText(body.parentUid, 100) : uid;
      const text = clampText(body.text, 400);
      if (!parentUid || !text) return res.status(400).json({ error: "Missing parentUid or text" });

      let tokens = [];
      if (isStaff) {
        tokens = await getUserToken(db, parentUid);
      } else {
        // Send ONLY to assignedStaffUid if assigned; otherwise to all staff
        const chatDoc = await db.collection("chats").doc(parentUid).get();
        const chatData = chatDoc.exists ? chatDoc.data() : {};
        if (chatData.chatStatus === "assigned" && chatData.assignedStaffUid) {
          tokens = await getUserToken(db, chatData.assignedStaffUid);
        } else {
          tokens = await getStaffTokens(db, uid);
        }
      }

      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", notification: { channelId: "mind_chat_ch" } },
        notification: { title: `رسالة جديدة من ${trustedName}`, body: text },
        data: { type: "chat", parentUid }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "support_request") {
      const tokens = await getStaffTokens(db, uid);
      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", notification: { channelId: "mind_chat_ch" } },
        notification: {
          title: "طلب دعم جديد",
          body: `${trustedName} بانتظار قبول أحد الأخصائيين لبدء المحادثة`
        },
        data: { type: "chat", parentUid: uid }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "new_booking") {
      const date = clampText(body.date, 30);
      const time = clampText(body.time, 30);
      const childName = clampText(callerData.childName || trustedName, 80);
      const tokens = await getStaffTokens(db, uid);
      if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
      const result = await fcm.sendEachForMulticast({
        tokens,
        android: { priority: "high", notification: { channelId: "mind_bookings_ch" } },
        notification: {
          title: "طلب حجز جلسة جديد",
          body: `${childName} حجز موعد ${date} الساعة ${time}`
        }
      });
      return res.status(200).json({ ok: true, sent: result.successCount });
    }

    if (type === "announcement") {
      if (role !== "admin") return res.status(403).json({ error: "Admin only" });
      const target = String(body.target || "all");
      const text = clampText(body.text, 500);
      const topic = target === "parent" ? "role_parent" : target === "staff" ? "role_staff" : "all_users";
      await fcm.send({
        topic,
        android: { priority: "high" },
        data: { type: "announcement", title: "إعلان من Mind Academy", body: text }
      });
      return res.status(200).json({ ok: true, topic });
    }

    if (type === "session_update") {
      const parentUid = clampText(body.parentUid, 100);
      const date = clampText(body.date, 30);
      const time = clampText(body.time, 30);
      const status = String(body.status || "");

      if (status === "cancelled") {
        const tokens = await getStaffTokens(db, uid);
        if (!tokens.length) return res.status(200).json({ ok: true, sent: 0 });
        const result = await fcm.sendEachForMulticast({
          tokens,
          android: { priority: "high", notification: { channelId: "mind_bookings_ch" } },
          notification: {
            title: "تم إلغاء موعد جلسة",
            body: `${trustedName} ألغى موعد ${date} الساعة ${time}`
          }
        });
        return res.status(200).json({ ok: true, sent: result.successCount });
      }

      if ((status === "confirmed" || status === "rejected") && isStaff) {
        const tokens = await getUserToken(db, parentUid);
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
    return res.status(err.status || 500).json({ error: err.message || "Internal Server Error" });
  }
};
