const { verifyCaller } = require("./_firebase");
const {
  DEFAULT_ROOT_FOLDER_ID,
  getDriveAccessToken,
  createChildFolderWithSubs
} = require("./_drive");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  try {
    const { db, isStaff } = await verifyCaller(req);
    if (!isStaff) return res.status(403).json({ ok: false, error: "Staff or Admin only" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const parentUid = String(body.parentUid || "").trim();
    const childName = String(body.childName || "Child").trim();

    const driveCfgDoc = await db.collection("settings").doc("drive").get();
    const driveCfg = driveCfgDoc.exists ? driveCfgDoc.data() : {};
    const rootId = String(driveCfg.rootFolderId || DEFAULT_ROOT_FOLDER_ID).trim();
    const subfolders = String(driveCfg.subfolders || "فيديوهات الجلسات,التقارير").trim();

    const token = await getDriveAccessToken();
    const result = await createChildFolderWithSubs(token, rootId, childName, parentUid, subfolders);

    if (parentUid) {
      await db.collection("users").doc(parentUid).update({ driveLink: result.viewLink });
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message || "Drive error" });
  }
};
