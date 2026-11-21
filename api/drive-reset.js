const { verifyCaller } = require("./_firebase");
const {
  DEFAULT_ROOT_FOLDER_ID,
  getDriveAccessToken,
  createChildFolderWithSubs,
  listFolderItems,
  deleteDriveItem
} = require("./_drive");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  try {
    const { db, role } = await verifyCaller(req);
    if (role !== "admin") return res.status(403).json({ ok: false, error: "Admin only" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const rebuild = body.rebuild !== false;

    const driveCfgDoc = await db.collection("settings").doc("drive").get();
    const driveCfg = driveCfgDoc.exists ? driveCfgDoc.data() : {};
    const rootId = String(driveCfg.rootFolderId || DEFAULT_ROOT_FOLDER_ID).trim();
    const subfolders = String(driveCfg.subfolders || "فيديوهات الجلسات,التقارير").trim();

    const token = await getDriveAccessToken();

    // 1. Delete/trash all existing files & folders inside root folder
    const existing = await listFolderItems(token, rootId);
    let deletedCount = 0;
    for (const item of existing) {
      await deleteDriveItem(token, item.id);
      deletedCount++;
    }

    // 2. Rebuild fresh empty folders for all approved parents
    let rebuiltCount = 0;
    if (rebuild) {
      const parentsSnap = await db.collection("users")
        .where("role", "==", "parent")
        .where("status", "==", "approved")
        .get();

      for (const doc of parentsSnap.docs) {
        const u = doc.data();
        if (u.banned === true) continue;
        const cName = u.childName || u.motherName || (u.email || "").split("@")[0] || "Child";
        const created = await createChildFolderWithSubs(token, rootId, cName, doc.id, subfolders);
        await doc.ref.update({ driveLink: created.viewLink });
        rebuiltCount++;
      }
    }

    return res.status(200).json({ ok: true, deletedCount, rebuiltCount });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message || "Reset failed" });
  }
};
