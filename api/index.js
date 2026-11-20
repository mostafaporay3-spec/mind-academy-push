module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    service: "Mind Academy Push & Drive Server v5 (Learnexa Systems)",
    endpoints: ["/api/push", "/api/call-start", "/api/call-refund", "/api/delete-user", "/api/drive-folder", "/api/drive-reset", "/api/reminders"]
  });
};
