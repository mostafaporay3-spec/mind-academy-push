const crypto = require("crypto");

const DEFAULT_ROOT_FOLDER_ID = "1EJTbB1Z19BktseybMu7zPPjRXvFqky0V";

function getServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT");
  const trimmed = raw.trim();
  const parsed = trimmed.startsWith("{")
    ? JSON.parse(trimmed)
    : JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"));
  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  }
  return parsed;
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getDriveAccessToken() {
  const sa = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = `${header}.${claim}`;
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`
    })
  });
  const data = await resp.json();
  if (!resp.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Failed to get Drive token");
  }
  return data.access_token;
}

async function driveReq(token, url, method = "GET", body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  };
  const resp = await fetch(url, opts);
  if (resp.status === 204) return {};
  const text = await resp.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!resp.ok) {
    throw new Error(json.error?.message || `Drive API HTTP ${resp.status}`);
  }
  return json;
}

async function createFolder(token, name, parentId) {
  return driveReq(token, "https://www.googleapis.com/drive/v3/files?fields=id", "POST", {
    name,
    parents: [parentId],
    mimeType: "application/vnd.google-apps.folder"
  });
}

async function createChildFolderWithSubs(token, rootId, childName, parentUid, subfoldersStr) {
  const safeName = String(childName || "Child").trim();
  const shortUid = String(parentUid || "").slice(0, 6);
  const folderName = shortUid ? `Child_${safeName}_${shortUid}` : `Child_${safeName}`;

  const created = await createFolder(token, folderName, rootId);
  const folderId = created.id;

  await driveReq(
    token,
    `https://www.googleapis.com/drive/v3/files/${folderId}/permissions`,
    "POST",
    { type: "anyone", role: "reader" }
  );

  if (subfoldersStr) {
    const subs = String(subfoldersStr).split(",").map((s) => s.trim()).filter(Boolean);
    for (const sub of subs) {
      await createFolder(token, sub, folderId);
    }
  }

  return {
    folderId,
    viewLink: `https://drive.google.com/drive/folders/${folderId}`
  };
}

async function listFolderItems(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const data = await driveReq(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType)&pageSize=200`
  );
  return data.files || [];
}

async function deleteDriveItem(token, fileId) {
  try {
    await driveReq(token, `https://www.googleapis.com/drive/v3/files/${fileId}`, "DELETE");
  } catch (_) {
    // Fallback to moving to trash if permanent delete is restricted by owner
    await driveReq(token, `https://www.googleapis.com/drive/v3/files/${fileId}`, "PATCH", { trashed: true });
  }
}

module.exports = {
  DEFAULT_ROOT_FOLDER_ID,
  getDriveAccessToken,
  createChildFolderWithSubs,
  listFolderItems,
  deleteDriveItem
};
