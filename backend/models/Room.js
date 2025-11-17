const mongoose = require('mongoose');

// ---------- PARTICIPANT SUB-SCHEMA ----------
const ParticipantSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },     // Google UID / unique ID
    username: { type: String, required: true },
    socketId: { type: String },               // useful for mapping users to sockets
    joinedAt: { type: Date, default: Date.now }
  },
  { _id: false }  // prevents auto _id for each participant
);

// ---------- ROOM SCHEMA ----------
const RoomSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  hostId: { type: String, required: false },

  participants: {
    type: [ParticipantSchema],
    default: []
  },

  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// ---------- INDEXES FOR PERFORMANCE ----------
RoomSchema.index({ code: 1 });            // faster lookups
RoomSchema.index({ isActive: 1 });
RoomSchema.index({ "participants.id": 1 });

module.exports = mongoose.model("Room", RoomSchema);
