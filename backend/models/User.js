const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
  googleId: { type: String },

  name: { type: String, required: true },

  username: { type: String, required: true },

  email: { type: String },   // ❗ REMOVE unique:true

  password: { type: String },

}, { timestamps: true });

// ❗ VERY IMPORTANT — REMOVE UNIQUE INDEXES
UserSchema.index({ email: 1 }, { unique: false });
UserSchema.index({ username: 1 }, { unique: false });

module.exports = mongoose.model("User", UserSchema);
