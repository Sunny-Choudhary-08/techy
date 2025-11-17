// ====== Updated TechMeet Backend - server.js ======
require('dotenv').config();
console.log("ENV Loaded?", process.env.MONGO_URI);

const path = require('path');
const express = require('express');
const http = require('http');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const mongoose = require('mongoose');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Room = require('./models/Room');
const { Server } = require('socket.io');
const cors = require('cors');

// ----- Express & HTTP Server -----
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

// ----- DB Connection -----
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error('MongoDB Error:', err));

// ----- Session Middleware -----
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "mysecret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: MONGO_URI,
    dbName: "TechMeetDB",
    collectionName: "sessions",
    ttl: 14 * 24 * 60 * 60  // 14 days
  }),
  cookie: {
    maxAge: 1000 * 60 * 60 * 24,  // 1 day
    httpOnly: true,
    secure: false
  }
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// ----- Passport Google Auth Setup -----
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK
}, (accessToken, refreshToken, profile, done) => {
  const user = {
    id: profile.id,
    displayName: profile.displayName,
    email: profile.emails?.[0]?.value || null
  };
  done(null, user);
}));

// ----- Serve Frontend -----
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ----- Auth Routes -----
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout?.(() => {});
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

// --- API: Current User ---
app.get('/api/me', (req, res) => {
  if (req.user) return res.json({ user: req.user });
  res.status(401).json({ error: 'not authenticated' });
});

// --- API: Create Room ---
app.post('/api/rooms', async (req, res) => {
  try {
    const { code, hostId } = req.body;
    if (!code) return res.json({ ok: false, error: 'code required' });

    const exists = await Room.findOne({ code });
    if (exists) return res.json({ ok: false, error: 'Room already exists' });

    const room = new Room({ code, hostId, isActive: true, participants: [] });
    await room.save();

    res.json({ ok: true, code });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// --- API: Check Room Exists ---
app.get('/api/rooms/:code', async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code });
    res.json({ exists: !!room, isActive: room?.isActive ?? false });
  } catch (err) {
    res.json({ exists: false });
  }
});

// --- API: End Room ---
app.post('/api/rooms/:code/end', async (req, res) => {
  try {
    const room = await Room.findOne({ code: req.params.code });
    if (!room) return res.json({ ok: false, error: 'not found' });

    room.isActive = false;
    await room.save();

    io.to(req.params.code).emit('room-ended', { room: req.params.code });

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ----- Socket.io + Rooms + Mongoose -----
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  console.log('Socket Connected:', socket.id);

  // JOIN ROOM
  socket.on('join-room', async ({ room, user }) => {
    try {
      if (!room || !user) return;
      socket.join(room);

      let roomDoc = await Room.findOne({ code: room });
      if (!roomDoc) {
        roomDoc = new Room({ code: room, hostId: user.id, isActive: true, participants: [] });
      }

      if (!roomDoc.participants.some((p) => p.id === user.id)) {
        roomDoc.participants.push({ id: user.id, username: user.username });
        await roomDoc.save();
      }

      socket.emit('existing-participants', {
        room,
        participants: roomDoc.participants,
        hostId: roomDoc.hostId
      });

      socket.to(room).emit('new-participant', {
        id: user.id,
        username: user.username
      });

    } catch (err) {
      console.error('join-room error:', err);
    }
  });

  // LEAVE ROOM
  socket.on('leave-room', async ({ room, userId }) => {
    try {
      socket.leave(room);

      const roomDoc = await Room.findOne({ code: room });
      if (roomDoc) {
        roomDoc.participants = roomDoc.participants.filter((p) => p.id !== userId);

        if (roomDoc.participants.length === 0) roomDoc.isActive = false;

        await roomDoc.save();
      }

      socket.to(room).emit('participant-left', { id: userId });
    } catch (err) {
      console.error('leave-room error:', err);
    }
  });

  // WEBRTC SIGNALING
  socket.on('offer', ({ room, offer, fromInfo }) => {
    socket.to(room).emit('offer', { fromInfo, offer });
  });

  socket.on('answer', ({ room, answer, fromInfo }) => {
    socket.to(room).emit('answer', { fromInfo, answer });
  });

  socket.on('ice-candidate', ({ room, candidate, fromInfo }) => {
    socket.to(room).emit('ice-candidate', { fromInfo, candidate });
  });

  socket.on('chat', ({ room, username, message }) => {
    io.to(room).emit('chat-message', { username, message });
  });

  socket.on('end-room', async ({ room }) => {
    io.to(room).emit('room-ended', { room });
    await Room.findOneAndUpdate({ code: room }, { isActive: false });
  });

  socket.on('disconnect', () => console.log('Socket Disconnected:', socket.id));
});

// ----- Start Server -----
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server listening on', PORT));