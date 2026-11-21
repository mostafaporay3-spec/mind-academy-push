const { verifyCaller } = require("./_firebase");
const { RtcTokenBuilder, RtcRole } = require("agora-token");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    await verifyCaller(req);
    const channelName = String(req.body?.channelName || "").trim();
    if (!channelName) {
      return res.status(400).json({ ok: false, error: "Missing channelName" });
    }

    const appId = (process.env.AGORA_APP_ID || "7124072378ac432789ed5592e45be003").trim();
    const appCertificate = (process.env.AGORA_APP_CERTIFICATE || "").trim();
    if (!appCertificate) {
      return res.status(500).json({ ok: false, error: "Missing AGORA_APP_CERTIFICATE in Vercel" });
    }

    const tokenExpireSeconds = 3600;
    const privilegeExpireSeconds = 3600;
    const token = RtcTokenBuilder.buildTokenWithUid(
      appId,
      appCertificate,
      channelName,
      0,
      RtcRole.PUBLISHER,
      tokenExpireSeconds,
      privilegeExpireSeconds
    );

    return res.status(200).json({ ok: true, token });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message || "Token error" });
  }
};
