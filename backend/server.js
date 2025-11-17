require("dotenv").config();
const express = require("express");
const path = require("path");
const http = require("http");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const cors = require("cors");

const User = require("./models/User");
const History = require("./models/History");
const Room = require("./models/Room");

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

/* ------------------------------------------------------
   MONGODB
------------------------------------------------------ */
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✔"))
  .catch(err => console.log("MongoDB Error:", err));

/* ------------------------------------------------------
   SESSION
------------------------------------------------------ */
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
  }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());

/* ------------------------------------------------------
   PASSPORT SERIALIZATION
------------------------------------------------------ */
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

/* ------------------------------------------------------
   AUTO-GENERATE UNIQUE USERNAME
------------------------------------------------------ */
async function generateUniqueUsername(base) {
  let username = base.toLowerCase().replace(/\s+/g, "");
  let exists = await User.findOne({ username });

  let counter = 1;
  while (exists) {
    username = `${base}_${counter}`;
    exists = await User.findOne({ username });
    counter++;
  }
  return username;
}

/* ------------------------------------------------------
   GOOGLE LOGIN STRATEGY
------------------------------------------------------ */
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK
    },
    async (accessToken, refreshToken, profile, done) => {
      const email = profile.emails?.[0]?.value;

      let user = await User.findOne({ googleId: profile.id });

      if (!user) {
        let baseUsername =
          email ? email.split("@")[0] : profile.displayName.replace(/\s+/g, "");

        const username = await generateUniqueUsername(baseUsername);

        user = await User.create({
          googleId: profile.id,
          name: profile.displayName,
          email: email,
          username: username
        });
      }

      return done(null, {
        id: user._id.toString(),
        name: user.name,
        email: user.email
      });
    }
  )
);

/* ------------------------------------------------------
   SIGNUP (AUTO USERNAME FIXED)
------------------------------------------------------ */
app.post("/api/signup", async (req, res) => {
  try {
    const { name, username, email, password } = req.body;

    if (!name || !username || !password)
      return res.json({ ok: false, error: "Missing required fields" });

    let finalUsername = await generateUniqueUsername(username);

    const existsEmail = email ? await User.findOne({ email }) : null;
    if (existsEmail)
      return res.json({ ok: false, error: "Email already exists" });

    const user = await User.create({
      name,
      username: finalUsername,
      email,
      password
    });

    req.login(
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email
      },
      () => res.json({ ok: true })
    );
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

/* ------------------------------------------------------
   LOGIN
------------------------------------------------------ */
app.post("/api/login", async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;

    const user = await User.findOne({
      $or: [{ username: usernameOrEmail }, { email: usernameOrEmail }]
    });

    if (!user) return res.json({ ok: false, error: "User not found" });
    if (user.password !== password)
      return res.json({ ok: false, error: "Incorrect password" });

    req.login(
      {
        id: user._id.toString(),
        name: user.name,
        email: user.email
      },
      () => res.json({ ok: true })
    );

  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

/* ------------------------------------------------------
   GOOGLE ROUTES
------------------------------------------------------ */
app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account"
  })
);

app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => res.redirect("/")
);

/* ------------------------------------------------------
   LOGOUT
------------------------------------------------------ */
app.get("/api/logout", (req, res) => {
  req.logout(() => {
    req.session.destroy(() => {
      res.clearCookie("connect.sid");
      res.json({ ok: true });
    });
  });
});

/* ------------------------------------------------------
   CURRENT USER
------------------------------------------------------ */
app.get("/api/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "Not logged in" });
  res.json({ user: req.user });
});

/* ------------------------------------------------------
   SAVE MEETING HISTORY
------------------------------------------------------ */
app.post("/api/history", async (req, res) => {
  try {
    if (!req.user)
      return res.status(401).json({ ok: false, error: "Not logged in" });

    const { meetingCode, action } = req.body;

    await History.create({
      userId: req.user.id,
      meetingCode,
      action,
      timestamp: new Date()
    });

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

/* ------------------------------------------------------
   GET HISTORY
------------------------------------------------------ */
app.get("/api/history", async (req, res) => {
  if (!req.user)
    return res.status(401).json({ ok: false, error: "Not logged in" });

  const history = await History.find({ userId: req.user.id }).sort({
    timestamp: -1
  });

  res.json({ ok: true, history });
});

/* ------------------------------------------------------
   STATIC FILES
------------------------------------------------------ */
app.use(express.static(path.join(__dirname, "..", "frontend")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "index.html"));
});

/* ------------------------------------------------------
   START
------------------------------------------------------ */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);
