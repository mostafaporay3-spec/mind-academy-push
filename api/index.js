module.exports = (req, res) => {
  res.status(200).json({
    ok: true,
    service: "Mind Academy Free Push Server (Vercel)",
    endpoints: ["/api/push", "/api/reminders"]
  });
};
