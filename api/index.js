module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    service: "Mind Academy Push & Signaling Server v3 (Learnexa Systems)",
    endpoints: ["/api/push", "/api/call-start", "/api/call-refund", "/api/delete-user", "/api/reminders"]
  });
};
