// Chat Interno XYZ — Node.js, Express, HTTP e Socket.IO.
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT) || 3000;
const ROOMS = [
  { id: 'geral', name: 'geral', description: 'Conversa com toda a equipe' },
  { id: 'projetos', name: 'projetos', description: 'Projetos e entregas' },
  { id: 'avisos', name: 'avisos', description: 'Avisos e novidades' }
];
const HISTORY_LIMIT = 100;
const STORE_PATH = path.join(__dirname, 'data', 'messages.json');
const DM_PATH = path.join(__dirname, 'data', 'private-messages.json');
const history = Object.fromEntries(ROOMS.map(room => [room.id, []]));
let privateHistory = {};

function loadJson(filename, fallback) {
  try { return JSON.parse(fs.readFileSync(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') console.warn('Histórico não carregado:', error.message); return fallback; }
}
const saved = loadJson(STORE_PATH, {});
for (const room of ROOMS) if (Array.isArray(saved[room.id])) history[room.id] = saved[room.id].slice(-HISTORY_LIMIT);
const savedPrivate = loadJson(DM_PATH, {});
if (savedPrivate && typeof savedPrivate === 'object' && !Array.isArray(savedPrivate)) {
  privateHistory = Object.fromEntries(Object.entries(savedPrivate).filter(([, v]) => Array.isArray(v)).map(([k,v]) => [k, v.slice(-HISTORY_LIMIT)]));
}
function saveJson(filename, content) {
  try {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const tmp = filename + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(content, null, 2));
    fs.renameSync(tmp, filename);
  } catch (error) { console.error('Falha ao salvar mensagens:', error.message); }
}
function clean(value, max) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function validId(id) { return /^[a-zA-Z0-9_-]{12,100}$/.test(id); }
function dmKey(a,b) { return [a,b].sort().join(':'); }
function onlineUsers() {
  const users = new Map();
  for (const s of io.sockets.sockets.values()) {
    if (s.data.clientId && s.data.name) users.set(s.data.clientId, { id: s.data.clientId, name: s.data.name });
  }
  return [...users.values()];
}
function roomUsers(roomId) {
  const sockets = io.sockets.adapter.rooms.get(roomId);
  if (!sockets) return [];
  const users = new Map();
  for (const id of sockets) {
    const s = io.sockets.sockets.get(id);
    if (s?.data.clientId && s?.data.name) users.set(s.data.clientId, { id: s.data.clientId, name: s.data.name });
  }
  return [...users.values()];
}
function refreshPresence() {
  io.emit('online users', onlineUsers());
  for (const room of ROOMS) io.to(room.id).emit('room users', roomUsers(room.id));
}
function stopTyping(socket) {
  if (socket.data.roomId) socket.to(socket.data.roomId).emit('typing', { id: socket.id, name: socket.data.name, typing: false });
  if (socket.data.peerId) socket.to('user:' + socket.data.peerId).emit('private typing', { id: socket.data.clientId, name: socket.data.name, typing: false });
}

app.use(express.static(path.join(__dirname, 'public'), { setHeaders(res, filePath) {
  if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
} }));
app.get('/health', (_req,res) => res.json({ ok: true }));

io.on('connection', socket => {
  socket.on('join room', (payload, ack) => {
    const name = clean(payload?.name, 24);
    const roomId = clean(payload?.roomId, 30);
    const clientId = clean(payload?.clientId, 100);
    if (!name || !ROOMS.some(room => room.id === roomId) || !validId(clientId)) {
      ack?.({ ok: false, error: 'Nome, canal ou identificação inválida.' }); return;
    }
    stopTyping(socket);
    const old = socket.data.roomId;
    if (old) socket.leave(old);
    socket.data.name = name;
    socket.data.clientId = clientId;
    socket.data.roomId = roomId;
    socket.data.peerId = null;
    socket.join('user:' + clientId);
    socket.join(roomId);
    ack?.({ ok: true, roomId, history: history[roomId], users: roomUsers(roomId), online: onlineUsers() });
    if (old !== roomId) io.to(roomId).emit('system message', `${name} entrou na sala.`);
    refreshPresence();
  });

  socket.on('open private', (payload, ack) => {
    const peerId = clean(payload?.peerId, 100);
    const name = clean(payload?.name, 24);
    const clientId = clean(payload?.clientId, 100);
    if (!name || !validId(clientId) || !validId(peerId) || peerId === clientId) {
      ack?.({ ok: false, error: 'Escolha outro participante.' }); return;
    }
    // Só cria conversas novas com contatos que estejam online. Históricos já existentes podem ser revisitados.
    const key = dmKey(clientId, peerId);
    const known = Array.isArray(privateHistory[key]);
    const peer = onlineUsers().find(u => u.id === peerId);
    if (!peer && !known) { ack?.({ ok: false, error: 'Este participante não está online.' }); return; }
    stopTyping(socket);
    if (socket.data.roomId) socket.leave(socket.data.roomId);
    socket.data.roomId = null;
    socket.data.name = name;
    socket.data.clientId = clientId;
    socket.data.peerId = peerId;
    socket.join('user:' + clientId);
    ack?.({ ok: true, peerName: peer?.name || clean(payload?.peerName, 24) || 'Participante', history: privateHistory[key] || [], online: onlineUsers() });
    refreshPresence();
  });

  socket.on('chat message', (payload, ack) => {
    const message = clean(payload?.message, 1000);
    const { name, roomId, clientId } = socket.data;
    if (!name || !roomId || !clientId || !history[roomId] || !message) { ack?.({ok:false,error:'Entre em um canal e escreva uma mensagem.'}); return; }
    const data = { id: crypto.randomUUID(), name, message, roomId, time: new Date().toISOString(), senderId: socket.id, senderClientId: clientId };
    history[roomId].push(data);
    history[roomId] = history[roomId].slice(-HISTORY_LIMIT);
    saveJson(STORE_PATH, history);
    io.to(roomId).emit('chat message', data);
    ack?.({ ok: true, id: data.id });
  });

  socket.on('private message', (payload, ack) => {
    const { name, clientId, peerId } = socket.data;
    const message = clean(payload?.message, 1000);
    if (!name || !clientId || !peerId || !message) { ack?.({ok:false,error:'Abra uma conversa privada para enviar.'}); return; }
    const key = dmKey(clientId, peerId);
    const data = { id: crypto.randomUUID(), name, message, time: new Date().toISOString(), senderClientId: clientId, recipientId: peerId, private: true };
    (privateHistory[key] ||= []).push(data);
    privateHistory[key] = privateHistory[key].slice(-HISTORY_LIMIT);
    saveJson(DM_PATH, privateHistory);
    io.to('user:' + clientId).to('user:' + peerId).emit('private message', data);
    ack?.({ok:true,id:data.id});
  });

  socket.on('typing', isTyping => {
    if (socket.data.roomId && socket.data.name) socket.to(socket.data.roomId).emit('typing', { id: socket.id, name: socket.data.name, typing: Boolean(isTyping) });
    else if (socket.data.peerId && socket.data.name) socket.to('user:' + socket.data.peerId).emit('private typing', { id: socket.data.clientId, name: socket.data.name, typing: Boolean(isTyping) });
  });
  socket.on('disconnect', () => { stopTyping(socket); refreshPresence(); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Conecta XYZ: http://localhost:${PORT}`));
