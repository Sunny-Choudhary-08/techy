const mongoose = require("mongoose");

const HistorySchema = new mongoose.Schema({
    userId: String,
    meetingCode: String,
    action: String,   // "started" or "joined"
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model("History", HistorySchema);
