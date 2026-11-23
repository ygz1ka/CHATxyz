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
const GROUP_PATH = path.join(__dirname, 'data', 'groups.json');
const PROFILE_PATH = path.join(__dirname, 'data', 'profiles.json');
const UPLOAD_DIR = path.join(__dirname, 'data', 'uploads');
const MAX_UPLOAD = 5 * 1024 * 1024;
const ALLOWED = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mp4': '.m4a', 'application/pdf': '.pdf', 'text/plain': '.txt', 'text/csv': '.csv', 'application/zip': '.zip', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx' };
const images = new Set(['image/jpeg','image/png','image/gif','image/webp']);
let groups = loadJson(GROUP_PATH, {});
let profiles = loadJson(PROFILE_PATH, {});
if (!groups || typeof groups !== 'object' || Array.isArray(groups)) groups = {};
if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) profiles = {};

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
function publicProfile(id) { return { avatar: profiles[id]?.avatar || null }; }
function myGroups(id) { return Object.values(groups).filter(g => Array.isArray(g.members) && g.members.includes(id)).map(g => ({ id:g.id, name:g.name, members:g.members })); }
function validAttachment(input) {
  if (!input) return null;
  if (typeof input !== 'object') return false;
  const id = clean(input.id, 80);
  const filename = clean(input.filename, 100);
  const mime = clean(input.mime, 120);
  if (!/^[0-9a-f-]{36}$/.test(id) || !filename || !ALLOWED[mime]) return false;
  const meta = uploadMeta.get(id);
  if (!meta || meta.mime !== mime || meta.filename !== filename) return false;
  return { id, filename, mime, url: '/uploads/' + id };
}
const uploadMeta = new Map();
function restoreAttachments() {
  const collections = [...Object.values(history), ...Object.values(privateHistory), ...Object.values(groups).map(g => g.history || [])];
  for (const arr of collections) for (const item of arr) if (item.attachment?.id) uploadMeta.set(item.attachment.id, item.attachment);
  const stored = loadJson(path.join(__dirname, 'data', 'uploads.json'), {});
  for (const [id, meta] of Object.entries(stored)) uploadMeta.set(id, meta);
}
function updateUploadMeta() { saveJson(path.join(__dirname, 'data', 'uploads.json'), Object.fromEntries(uploadMeta)); }
function verifyBytes(buf, mime) {
  if (mime==='image/png') return buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (mime==='image/jpeg') return buf[0]===255 && buf[1]===216 && buf[2]===255;
  if (mime==='image/gif') return ['GIF87a','GIF89a'].includes(buf.subarray(0,6).toString());
  if (mime==='image/webp') return buf.subarray(0,4).toString()==='RIFF' && buf.subarray(8,12).toString()==='WEBP';
  if (mime==='audio/webm') return buf.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]));
  if (mime==='audio/ogg') return buf.subarray(0,4).toString()==='OggS';
  if (mime==='audio/mp4') return buf.length>=12 && buf.subarray(4,8).toString()==='ftyp';
  if (mime==='application/pdf') return buf.subarray(0,5).toString()==='%PDF-';
  if (mime==='application/zip' || mime.includes('openxmlformats')) return buf.subarray(0,2).toString()==='PK';
  if (mime==='text/plain' || mime==='text/csv') return !buf.includes(0);
  return false;
}
restoreAttachments();
function onlineUsers() {
  const users = new Map();
  for (const s of io.sockets.sockets.values()) {
    if (s.data.clientId && s.data.name) users.set(s.data.clientId, { id: s.data.clientId, name: s.data.name, ...publicProfile(s.data.clientId) });
  }
  return [...users.values()];
}
function roomUsers(roomId) {
  const sockets = io.sockets.adapter.rooms.get(roomId);
  if (!sockets) return [];
  const users = new Map();
  for (const id of sockets) {
    const s = io.sockets.sockets.get(id);
    if (s?.data.clientId && s?.data.name) users.set(s.data.clientId, { id: s.data.clientId, name: s.data.name, ...publicProfile(s.data.clientId) });
  }
  return [...users.values()];
}
function refreshPresence() {
  io.emit('online users', onlineUsers());
  for (const room of ROOMS) io.to(room.id).emit('room users', roomUsers(room.id));
}
function stopTyping(socket) {
  if (socket.data.groupId) socket.to('group:' + socket.data.groupId).emit('group typing', { id: socket.data.clientId, name: socket.data.name, typing: false });
  if (socket.data.roomId) socket.to(socket.data.roomId).emit('typing', { id: socket.id, name: socket.data.name, typing: false });
  if (socket.data.peerId) socket.to('user:' + socket.data.peerId).emit('private typing', { id: socket.data.clientId, name: socket.data.name, typing: false });
}

app.use(express.static(path.join(__dirname, 'public'), { setHeaders(res, filePath) {
  if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
} }));
app.get('/health', (_req,res) => res.json({ ok: true }));
app.get('/uploads/:id', (req, res) => {
  const id = req.params.id;
  const meta = uploadMeta.get(id);
  if (!meta || !/^[0-9a-f-]{36}$/.test(id)) return res.sendStatus(404);
  const filename = path.join(UPLOAD_DIR, id);
  if (!fs.existsSync(filename)) return res.sendStatus(404);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Content-Type', meta.mime);
  res.setHeader('Content-Disposition', `${(images.has(meta.mime) || meta.mime.startsWith('audio/')) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(meta.filename)}`);
  res.sendFile(filename);
});
app.post('/api/upload', express.raw({type:'application/octet-stream',limit:'5mb'}), (req,res) => {
  const mime = clean(req.headers['x-file-type'],120);
  const filename = path.basename(clean(req.headers['x-file-name'] ? decodeURIComponentSafe(req.headers['x-file-name']) : 'arquivo',100));
  if (!ALLOWED[mime] || !Buffer.isBuffer(req.body) || req.body.length===0 || req.body.length > MAX_UPLOAD || !verifyBytes(req.body,mime)) return res.status(400).json({error:'Arquivo inválido ou formato não permitido (máx. 5 MB).'});
  const id = crypto.randomUUID();
  fs.mkdirSync(UPLOAD_DIR,{recursive:true});
  fs.writeFileSync(path.join(UPLOAD_DIR,id),req.body,{flag:'wx'});
  const meta = {id,mime,filename: filename || 'arquivo'};
  uploadMeta.set(id,meta); updateUploadMeta();
  res.json({ok:true,attachment:{...meta,url:'/uploads/'+id}});
});
function decodeURIComponentSafe(str) {try{return decodeURIComponent(str);}catch{return 'arquivo';}}
app.use((err,req,res,next) => { if (err.status===413 || err.type==='entity.too.large') return res.status(413).json({error:'Arquivo maior que 5 MB.'}); console.error(err);res.status(500).json({error:'Erro no servidor.'}); });

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
    socket.data.groupId = null;
    socket.join('user:' + clientId);
    for (const group of myGroups(clientId)) socket.join('group:' + group.id);
    socket.join(roomId);
    ack?.({ ok: true, roomId, history: history[roomId], users: roomUsers(roomId), online: onlineUsers(), groups: myGroups(clientId), profile: publicProfile(clientId) });
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
    socket.data.groupId = null;
    socket.join('user:' + clientId);
    for (const group of myGroups(clientId)) socket.join('group:' + group.id);
    ack?.({ ok: true, peerName: peer?.name || clean(payload?.peerName, 24) || 'Participante', history: privateHistory[key] || [], online: onlineUsers(), groups: myGroups(clientId), profile: publicProfile(clientId) });
    refreshPresence();
  });

  socket.on('update profile', (payload, ack) => {
    const id = socket.data.clientId;
    const avatar = clean(payload?.avatar,120);
    if (!id || (avatar && (!/^\/uploads\/[0-9a-f-]{36}$/.test(avatar) || !images.has(uploadMeta.get(avatar.slice(9))?.mime)))) return ack?.({ok:false,error:'Imagem de perfil inválida.'});
    profiles[id] = { avatar: avatar || null }; saveJson(PROFILE_PATH,profiles); refreshPresence();
    io.emit('profile updated',{id, avatar:profiles[id].avatar}); ack?.({ok:true});
  });
  socket.on('create group', (payload, ack) => {
    const owner = socket.data.clientId;
    const groupName = clean(payload?.name,48);
    const people = Array.isArray(payload?.members) ? payload.members.filter(validId) : [];
    const allowed = new Set(onlineUsers().map(u=>u.id));
    if (!owner || !groupName || people.length > 30 || people.some(id=>!allowed.has(id))) return ack?.({ok:false,error:'Nome ou participantes inválidos.'});
    const members = [...new Set([owner,...people])];
    if (members.length < 2) return ack?.({ok:false,error:'Escolha pelo menos um participante online.'});
    const id = crypto.randomUUID();
    groups[id] = {id,name:groupName,members,history:[],createdBy:owner};
    saveJson(GROUP_PATH,groups);
    for (const s of io.sockets.sockets.values()) if (members.includes(s.data.clientId)) {
      s.join('group:'+id); s.emit('groups updated',myGroups(s.data.clientId));
    }
    ack?.({ok:true,group:{id,name:groupName,members}});
  });
  socket.on('open group', (payload, ack) => {
    const id = clean(payload?.groupId,100);
    const group = groups[id]; const member = socket.data.clientId;
    if (!member || !group || !group.members.includes(member)) return ack?.({ok:false,error:'Grupo indisponível.'});
    stopTyping(socket); if(socket.data.roomId) socket.leave(socket.data.roomId);
    socket.data.roomId = null; socket.data.peerId = null; socket.data.groupId=id;
    socket.join('group:'+id);
    ack?.({ok:true,history:group.history,group:{id,name:group.name,members:group.members},online:onlineUsers(),groups:myGroups(member)});
    refreshPresence();
  });
  socket.on('group message', (payload, ack) => {
    const group = groups[socket.data.groupId]; const {clientId,name} = socket.data;
    const message=clean(payload?.message,1000), attachment=validAttachment(payload?.attachment);
    if(!group || !group.members.includes(clientId) || (!message&&!attachment) || attachment===false) return ack?.({ok:false,error:'Mensagem inválida ou grupo não autorizado.'});
    const data={id:crypto.randomUUID(),name,message,attachment:attachment||null,groupId:group.id,time:new Date().toISOString(),senderClientId:clientId,group:true,avatar:publicProfile(clientId).avatar};
    group.history.push(data);group.history=group.history.slice(-HISTORY_LIMIT);saveJson(GROUP_PATH,groups);
    io.to('group:'+group.id).emit('group message',data);ack?.({ok:true,id:data.id});
  });
  socket.on('chat message', (payload, ack) => {
    const message = clean(payload?.message, 1000);
    const attachment = validAttachment(payload?.attachment);
    const { name, roomId, clientId } = socket.data;
    if (!name || !roomId || !clientId || !history[roomId] || (!message && !attachment) || attachment === false) { ack?.({ok:false,error:'Entre em um canal e escreva uma mensagem.'}); return; }
    const data = { id: crypto.randomUUID(), name, message, attachment: attachment || null, avatar:publicProfile(clientId).avatar, roomId, time: new Date().toISOString(), senderId: socket.id, senderClientId: clientId };
    history[roomId].push(data);
    history[roomId] = history[roomId].slice(-HISTORY_LIMIT);
    saveJson(STORE_PATH, history);
    io.to(roomId).emit('chat message', data);
    ack?.({ ok: true, id: data.id });
  });

  socket.on('private message', (payload, ack) => {
    const { name, clientId, peerId } = socket.data;
    const message = clean(payload?.message, 1000);
    const attachment = validAttachment(payload?.attachment);
    if (!name || !clientId || !peerId || (!message && !attachment) || attachment === false) { ack?.({ok:false,error:'Abra uma conversa privada para enviar.'}); return; }
    const key = dmKey(clientId, peerId);
    const data = { id: crypto.randomUUID(), name, message, attachment:attachment||null, avatar:publicProfile(clientId).avatar, time: new Date().toISOString(), senderClientId: clientId, recipientId: peerId, private: true };
    (privateHistory[key] ||= []).push(data);
    privateHistory[key] = privateHistory[key].slice(-HISTORY_LIMIT);
    saveJson(DM_PATH, privateHistory);
    io.to('user:' + clientId).to('user:' + peerId).emit('private message', data);
    ack?.({ok:true,id:data.id});
  });

  socket.on('typing', isTyping => {
    if (socket.data.groupId && socket.data.name) socket.to('group:'+socket.data.groupId).emit('group typing',{id:socket.data.clientId,name:socket.data.name,typing:Boolean(isTyping)});
    else if (socket.data.roomId && socket.data.name) socket.to(socket.data.roomId).emit('typing', { id: socket.id, name: socket.data.name, typing: Boolean(isTyping) });
    else if (socket.data.peerId && socket.data.name) socket.to('user:' + socket.data.peerId).emit('private typing', { id: socket.data.clientId, name: socket.data.name, typing: Boolean(isTyping) });
  });
  socket.on('disconnect', () => { stopTyping(socket); refreshPresence(); });
});

server.listen(PORT, '0.0.0.0', () => console.log(`Conecta XYZ: http://localhost:${PORT}`));
