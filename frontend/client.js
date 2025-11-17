// client.js — socket + basic mesh WebRTC
const socket = io(); // connects to same origin backend

let localStream = null;
const peers = {}; // peerId -> RTCPeerConnection
const remoteElements = {}; // peerId -> video element
const configuration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
    // For production add TURN server here
  ]
};

async function getLocalStream() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  addLocalVideo();
  return localStream;
}

function addLocalVideo() {
  const container = document.getElementById('videos');
  const el = document.createElement('div');
  el.className = 'video-box local';
  el.id = 'localBox';
  el.innerHTML = `<video autoplay muted playsinline id="localVideo" style="width:100%;height:100%;object-fit:cover;"></video>`;
  container.prepend(el);
  const v = document.getElementById('localVideo');
  v.srcObject = localStream;
  v.play().catch(()=>{});
}

// helper to create remote element
function createRemoteEl(id, name) {
  const container = document.getElementById('videos');
  const el = document.createElement('div');
  el.className = 'video-box';
  el.id = 'peer-' + id;
  el.innerHTML = `<video autoplay playsinline id="video-${id}" style="width:100%;height:100%;object-fit:cover;"></video><div class="label">${name||id}</div>`;
  container.appendChild(el);
  remoteElements[id] = el;
}

// start/join room
async function joinRoom(roomCode, displayName) {
  await getLocalStream();
  socket.emit('join-room', { room: roomCode, user: { id: socket.id, username: displayName || 'Guest' }});
}

// signaling handlers
socket.on('existing-participants', async ({ room, participants }) => {
  console.log('existing', participants);
  // create offer to each existing participant
  for (const p of participants) {
    if (p.id === socket.id) continue;
    await createOfferTo(p.id, p.username);
  }
});

socket.on('new-participant', async ({ id, username }) => {
  console.log('new participant', id);
  createRemoteEl(id, username);
});

// when someone sends an offer
socket.on('offer', async ({ fromId, offer }) => {
  if (peers[fromId]) return;
  await getLocalStream();
  const pc = new RTCPeerConnection(configuration);
  peers[fromId] = pc;
  attachLocalTracks(pc);

  pc.ontrack = (ev) => {
    const el = document.getElementById('video-'+fromId) || (() => {
      createRemoteEl(fromId);
      return document.getElementById('video-'+fromId);
    })();
    el.srcObject = ev.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { room: null, to: fromId, candidate: event.candidate });
    }
  };

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('answer', { to: fromId, answer });
});

// when someone sends an answer
socket.on('answer', async ({ fromId, answer }) => {
  const pc = peers[fromId];
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

// ice candidate
socket.on('ice-candidate', async ({ fromId, candidate }) => {
  const pc = peers[fromId];
  if (!pc) return;
  try {
    await pc.addIceCandidate(candidate);
  } catch (e) { console.warn(e); }
});

// create offer helper
async function createOfferTo(peerId, username) {
  if (peers[peerId]) return;
  const pc = new RTCPeerConnection(configuration);
  peers[peerId] = pc;
  attachLocalTracks(pc);

  pc.ontrack = (ev) => {
    const el = document.getElementById('video-'+peerId) || (() => {
      createRemoteEl(peerId, username);
      return document.getElementById('video-'+peerId);
    })();
    el.srcObject = ev.streams[0];
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('ice-candidate', { room: null, to: peerId, candidate: event.candidate });
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('offer', { room: null, to: peerId, offer });
}

function attachLocalTracks(pc) {
  if (!localStream) return;
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
}

// Chat
const chatForm = document.getElementById('chatForm');
if (chatForm) {
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const msg = input.value.trim();
    if (!msg) return;
    socket.emit('chat', { room: currentRoom, username: displayName, message: msg });
    input.value = '';
  });
}

socket.on('chat-message', ({ username, message }) => {
  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<strong>${username}:</strong> ${message}`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
});

// Expose join function globally
window.joinRoom = joinRoom;
let currentRoom = null;
let displayName = localStorage.getItem('zoomUser') || 'Guest';

// helper to start from UI
window.startLocalAndJoin = async function(mode) {
  // mode: 'start' or 'join'
  displayName = localStorage.getItem('zoomUser') || 'Guest';
  const params = new URLSearchParams(window.location.search);
  let room = params.get('code');
  if (!room) {
    room = Math.random().toString(36).substring(2,8).toUpperCase();
    // show code in UI
    const el = document.getElementById('meetingCode');
    if (el) el.textContent = '#' + room;
  }
  currentRoom = room;
  await joinRoom(room, displayName);
  // show share modal with code
  const modal = document.getElementById('modalMeetingCode');
  if (modal) modal.textContent = '#' + room;
};

// client.js — TechMeet UI integration + socket + simple WebRTC mesh
const socket = io(); // same-origin

// UI refs
const videos = document.getElementById('videos');
const meetingCodeEl = document.getElementById('meetingCode');
const modalCodeEl = document.getElementById('modalMeetingCode');
const chatBox = document.getElementById('chatBox');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const participantsContainer = document.createElement('div');

// state
let localStream = null;
let peers = {}; // peerId -> RTCPeerConnection
let userId = null;
let roomCode = null;
let username = (window.__USER && window.__USER.displayName) || 'Host';

// WebRTC config
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// add participants container into sidebar
(function attachParticipantsArea(){
  const side = document.querySelector('.participants-card');
  if(!side){
    // create and append
    const node = document.createElement('div');
    node.className='participants-card';
    node.id='participantsList';
    const sidebar = document.querySelector('.sidebar');
    if(sidebar) sidebar.insertBefore(node, sidebar.querySelector('.chat-section'));
  }
})();

// helpers for UI
function addLocalVideo(){
  if(document.getElementById('localBox')) return;
  const box = document.createElement('div'); box.className='video-box local'; box.id='localBox';
  box.innerHTML = `<video id="localVideo" autoplay muted playsinline></video><div class="video-label">You (Host)</div>`;
  videos.prepend(box);
  const v = document.getElementById('localVideo'); v.srcObject = localStream;
}

function createRemoteBox(id, name){
  if(document.getElementById('peer-'+id)) return;
  const box = document.createElement('div'); box.className='video-box'; box.id='peer-'+id;
  box.innerHTML = `<video id="video-${id}" autoplay playsinline></video><div class="video-label">${name || id}</div>`;
  videos.appendChild(box);
}

function updateParticipantsUI(list){
  const container = document.getElementById('participantsList') || document.createElement('div');
  container.id='participantsList';
  container.innerHTML = '';
  list.forEach(p => {
    const el = document.createElement('div'); el.className='participant';
    el.innerHTML = `<div class="part-left"><img src="logo.jpg" alt=""><div class="part-name">${p.username
