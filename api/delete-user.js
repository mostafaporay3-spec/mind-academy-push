const { verifyCaller } = require("./_firebase");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  try {
    const { admin, db, uid, role } = await verifyCaller(req);
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const targetUid = String(body.targetUid || uid);

    const isSelf = targetUid === uid;
    if (!isSelf && role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }

    const userRef = db.collection("users").doc(targetUid);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const u = userSnap.data();
      if (u.email === "mostafaporay3@gmail.com") {
        return res.status(403).json({ error: "Cannot delete super admin" });
      }
      if (u.role === "parent") {
        const now = Date.now();
        const sixMonthsMs = 180 * 24 * 60 * 60 * 1000;
        await db.collection("archived_parents").doc(`${targetUid}_${now}`).set({
          uid: targetUid,
          motherName: u.motherName || "",
          childName: u.childName || "",
          motherPhone: u.motherPhone || "",
          fatherPhone: u.fatherPhone || "",
          email: u.email || "",
          driveLink: u.driveLink || "",
          archivedAt: now,
          expiresAt: now + sixMonthsMs
        });
      }
    }

    // Delete sessions, booked_slots, chats, chat_sessions, and user doc
    const sessions = await db.collection("sessions").where("parentUid", "==", targetUid).get();
    for (const doc of sessions.docs) {
      const s = doc.data();
      await doc.ref.delete();
      await db.collection("booked_slots").doc(doc.id).delete();
      if (s.date && s.time && s.status !== "rejected" && s.status !== "cancelled") {
        const cKey = `${s.date}_${String(s.time).replace(":", "")}`;
        const cRef = db.collection("slot_counters").doc(cKey);
        await db.runTransaction(async (tx) => {
          const snap = await tx.get(cRef);
          if (snap.exists) {
            tx.update(cRef, { count: Math.max(0, (snap.data().count || 0) - 1) });
          }
        });
      }
    }

    const chatSess = await db.collection("chat_sessions").where("parentUid", "==", targetUid).get();
    for (const doc of chatSess.docs) await doc.ref.delete();
    await db.collection("chats").doc(targetUid).delete();
    await userRef.delete();

    // Delete Firebase Auth user
    try {
      await admin.auth().deleteUser(targetUid);
    } catch (_) {}

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
};
