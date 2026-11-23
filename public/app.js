const socket = io({ reconnection: true });
const $ = id => document.getElementById(id);
const rooms = {
  geral: { name: 'geral', description: 'Conversa com toda a equipe' },
  projetos: { name: 'projetos', description: 'Projetos e entregas' },
  avisos: { name: 'avisos', description: 'Avisos e novidades' }
};
const existingId = localStorage.getItem('xyz-client-id') || sessionStorage.getItem('xyz-client-id');
const clientId = existingId && /^[a-zA-Z0-9_-]{12,100}$/.test(existingId) ? existingId :
  ((globalThis.crypto && typeof crypto.randomUUID === 'function') ? crypto.randomUUID() :
    'user_' + Array.from({length: 5}, () => Math.random().toString(36).slice(2)).join(''));
localStorage.setItem('xyz-client-id', clientId);
let name = sessionStorage.getItem('xyz-name') || '';
let activeRoom = 'geral';
let activePeer = null;
let joined = false;
let joinVersion = 0;
let sending = false;
let typingTimeout;
let knownPeers = {};
let onlineUsers = [];
const renderedIds = new Set();
const typingUsers = new Map();
try { knownPeers = JSON.parse(localStorage.getItem('xyz-known-peers') || '{}'); } catch { knownPeers = {}; }

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}
function savePeers() { localStorage.setItem('xyz-known-peers', JSON.stringify(knownPeers)); }
function stopTyping() { clearTimeout(typingTimeout); if (joined && socket.connected) socket.emit('typing', false); }
function clearTyping() { typingUsers.clear(); $('typing').textContent = ''; }
function updateTyping() {
  const users = [...typingUsers.values()].filter(n => n !== name);
  $('typing').textContent = users.length ? `${users.slice(0, 2).join(', ')} ${users.length === 1 ? 'está' : 'estão'} digitando...` : '';
}
function scrollDown() { $('conversation').scrollTop = $('conversation').scrollHeight; }
function addSystem(text) {
  if (activePeer) return;
  const el = document.createElement('div'); el.className = 'system-message'; el.textContent = text;
  $('messages').appendChild(el); scrollDown();
}
function isMyMessage(data) {
  // Identidade persistente no navegador permite alinhar inclusive o histórico anterior.
  if (data.senderClientId === clientId) return true;
  if (data.private) return false;
  // Mensagens públicas antigas podem ter um ID de sessão anterior.
  // Se houver outro usuário online com o mesmo nome, evitamos atribuição incorreta.
  const otherWithSameName = onlineUsers.some(u => u.id !== clientId && u.name === name);
  return !otherWithSameName && data.name === name;
}
function messageFits(data) {
  if (!data || typeof data.message !== 'string') return false;
  if (activePeer) return data.private === true &&
    ((data.senderClientId === clientId && data.recipientId === activePeer.id) ||
     (data.senderClientId === activePeer.id && data.recipientId === clientId));
  return !data.private && data.roomId === activeRoom;
}
function addMessage(data) {
  if (!messageFits(data) || !data.name || (data.id && renderedIds.has(data.id))) return;
  if (data.id) renderedIds.add(data.id);
  const mine = isMyMessage(data);
  const row = document.createElement('div'); row.className = 'message' + (mine ? ' self' : '');
  const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = data.name[0].toUpperCase();
  const body = document.createElement('div'); body.className = 'message-body';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const author = document.createElement('strong'); author.textContent = mine ? 'Você' : data.name;
  const time = document.createElement('time'); const date = new Date(data.time);
  time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const message = document.createElement('div'); message.className = 'message-text'; message.textContent = data.message;
  meta.append(author, time); body.append(meta, message); row.append(avatar, body);
  $('messages').appendChild(row); scrollDown();
}
function renderHeader() {
  if (activePeer) {
    $('channelIcon').textContent = '✉';
    $('channelTitle').textContent = activePeer.name;
    $('channelSubtitle').textContent = onlineUsers.some(u => u.id === activePeer.id) ? 'Conversa privada • online' : 'Conversa privada • offline';
    $('welcomeTitle').textContent = activePeer.name;
    $('welcomeText').textContent = 'Esta é uma conversa privada. Somente os dois participantes recebem as mensagens pelo chat.';
    $('messageInput').placeholder = `Mensagem privada para ${activePeer.name}`;
  } else {
    const room = rooms[activeRoom];
    $('channelIcon').textContent = '#';
    $('channelTitle').textContent = room.name;
    $('channelSubtitle').textContent = room.description;
    $('welcomeTitle').textContent = '# ' + room.name;
    $('welcomeText').textContent = `Este é o começo do canal #${room.name}. Compartilhe uma ideia ou diga olá para a equipe!`;
    $('messageInput').placeholder = `Enviar mensagem para #${room.name}`;
  }
  document.querySelectorAll('.room').forEach(button => button.classList.toggle('active', !activePeer && button.dataset.room === activeRoom));
  renderPrivateList();
}
function renderMembers(users) {
  $('onlineCount').textContent = users.length;
  $('membersCount').textContent = users.length;
  $('membersList').replaceChildren();
  for (const user of users) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'member member-action';
    const avatar = document.createElement('div'); avatar.className = 'avatar'; avatar.textContent = user.name[0].toUpperCase();
    const info = document.createElement('div'); const strong = document.createElement('strong');
    strong.textContent = user.name + (user.id === clientId ? ' (você)' : '');
    const sub = document.createElement('span'); sub.textContent = user.id === clientId ? 'Seu perfil' : 'Clique para conversar';
    info.append(strong, sub); item.append(avatar, info);
    if (user.id === clientId) item.disabled = true;
    else item.addEventListener('click', () => openPrivate(user));
    $('membersList').appendChild(item);
  }
}
function renderPrivateList() {
  const list = $('privateList'); list.replaceChildren();
  const all = new Map(Object.entries(knownPeers).map(([id, label]) => [id, {id, name: label}]));
  for (const user of onlineUsers) if (user.id !== clientId) all.set(user.id, user);
  if (!all.size) {
    const help = document.createElement('span'); help.className = 'private-help';
    help.textContent = 'Quando outro usuário entrar, ele aparecerá aqui.'; list.appendChild(help);
  }
  for (const peer of all.values()) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = 'private-contact' + (activePeer?.id === peer.id ? ' active' : '');
    const avatar = document.createElement('span'); avatar.className = 'contact-avatar'; avatar.textContent = peer.name[0]?.toUpperCase() || '?';
    const label = document.createElement('span'); label.textContent = peer.name;
    const online = document.createElement('span'); online.className = 'contact-presence' + (onlineUsers.some(u => u.id === peer.id) ? ' is-online' : '');
    button.append(avatar, label, online);
    button.addEventListener('click', () => openPrivate(peer));
    list.appendChild(button);
  }
}
function setOnline(users) {
  onlineUsers = Array.isArray(users) ? users.filter(u => u && typeof u.id === 'string' && typeof u.name === 'string') : [];
  renderMembers(onlineUsers);
  renderPrivateList();
  renderHeader();
}
function resetView() {
  joined = false; sending = false;
  $('messageInput').disabled = false; $('messages').replaceChildren(); renderedIds.clear();
  clearTyping(); renderHeader();
  $('sidebar').classList.remove('show');
  $('messageInput').focus();
}
function enterCurrent() {
  if (!name || !socket.connected) { if (name) toast('Aguardando conexão com o servidor.'); return; }
  const version = ++joinVersion;
  const peer = activePeer ? {...activePeer} : null;
  const roomId = activeRoom;
  joined = false;
  const event = peer ? 'open private' : 'join room';
  const payload = peer ? { name, clientId, peerId: peer.id, peerName: peer.name } : { name, clientId, roomId };
  socket.timeout(8000).emit(event, payload, (error, response) => {
    if (version !== joinVersion || (peer ? activePeer?.id !== peer.id : activePeer || activeRoom !== roomId)) return;
    if (error || !response?.ok) { toast(response?.error || 'Não foi possível abrir a conversa.'); $('profileStatus').textContent = 'Conexão pendente'; return; }
    joined = true;
    $('profileStatus').textContent = 'Online';
    $('messages').replaceChildren(); renderedIds.clear(); clearTyping();
    setOnline(response.online || onlineUsers);
    (Array.isArray(response.history) ? response.history : []).forEach(addMessage);
    if (peer && response.peerName && peer.name !== response.peerName) { activePeer.name = response.peerName; knownPeers[peer.id] = response.peerName; savePeers(); renderHeader(); }
    scrollDown(); $('messageInput').focus();
  });
}
function setRoom(roomId) {
  if (!rooms[roomId] || (!activePeer && activeRoom === roomId && joined)) return;
  stopTyping(); activePeer = null; activeRoom = roomId; ++joinVersion; resetView(); enterCurrent();
}
function openPrivate(peer) {
  if (!peer || peer.id === clientId) return;
  stopTyping(); activePeer = {id: peer.id, name: peer.name};
  knownPeers[peer.id] = peer.name; savePeers(); ++joinVersion; resetView(); enterCurrent();
}
function showLogin() { $('nameInput').value = name; $('nameOverlay').classList.remove('hidden'); }
$('nameForm').addEventListener('submit', event => {
  event.preventDefault(); const next = $('nameInput').value.trim().slice(0, 24);
  if (!next) { $('nameError').textContent = 'Digite seu nome para continuar.'; return; }
  $('nameError').textContent = ''; name = next; sessionStorage.setItem('xyz-name', name);
  $('profileName').textContent = name; $('profileAvatar').textContent = name[0].toUpperCase();
  $('nameOverlay').classList.add('hidden'); enterCurrent();
});
$('editName').addEventListener('click', showLogin);
$('roomList').addEventListener('click', event => { const btn = event.target.closest('[data-room]'); if (btn) setRoom(btn.dataset.room); });
$('messageForm').addEventListener('submit', event => {
  event.preventDefault(); const message = $('messageInput').value.trim();
  if (!message) { toast('Digite uma mensagem.'); return; }
  if (!name) { showLogin(); return; }
  if (!socket.connected || !joined) { toast('Reconectando ao chat. Tente novamente.'); enterCurrent(); return; }
  if (sending) return;
  sending = true; $('messageInput').disabled = true;
  const targetPeer = activePeer?.id || null; const targetRoom = activeRoom;
  socket.timeout(8000).emit(targetPeer ? 'private message' : 'chat message', { message }, (error, response) => {
    sending = false; $('messageInput').disabled = false;
    if (error || !response?.ok) toast(response?.error || 'Envio não confirmado. Confira a conversa antes de reenviar.');
    else if (targetPeer === (activePeer?.id || null) && targetRoom === activeRoom && $('messageInput').value === message) {
      $('messageInput').value = ''; stopTyping();
    }
    $('messageInput').focus();
  });
});
$('messageInput').addEventListener('input', () => {
  if (!joined) return;
  socket.emit('typing', Boolean($('messageInput').value.trim()));
  clearTimeout(typingTimeout); typingTimeout = setTimeout(() => socket.emit('typing', false), 1100);
});
$('menuButton').addEventListener('click', () => $('sidebar').classList.toggle('show'));
$('membersButton').addEventListener('click', () => $('membersPanel').classList.toggle('show'));
$('closeMembers').addEventListener('click', () => $('membersPanel').classList.remove('show'));
socket.on('connect', () => { $('profileStatus').textContent = 'Conectado'; if (name) enterCurrent(); });
socket.on('disconnect', () => {
  ++joinVersion; joined = false; sending = false; $('messageInput').disabled = false;
  $('profileStatus').textContent = 'Reconectando...'; setOnline([]); clearTyping(); toast('Conexão perdida. Tentando reconectar...');
});
socket.on('connect_error', () => toast('Servidor indisponível. Verifique o endereço do chat.'));
socket.on('chat message', addMessage);
socket.on('private message', data => {
  if (data?.senderClientId && data?.recipientId && (data.recipientId === clientId || data.senderClientId === clientId)) {
    const otherId = data.senderClientId === clientId ? data.recipientId : data.senderClientId;
    if (!knownPeers[otherId]) { knownPeers[otherId] = onlineUsers.find(u => u.id === otherId)?.name || (data.senderClientId === otherId ? data.name : 'Participante'); savePeers(); renderPrivateList(); }
    if (!activePeer || activePeer.id !== otherId) toast('Nova mensagem privada de ' + knownPeers[otherId]);
  }
  addMessage(data);
});
socket.on('system message', text => { if (joined) addSystem(text); });
socket.on('online users', setOnline);
socket.on('room users', () => {}); // Mantém compatibilidade com os canais.
socket.on('typing', data => {
  if (!joined || activePeer || !data?.id) return;
  if (data.typing) typingUsers.set(data.id, data.name); else typingUsers.delete(data.id);
  updateTyping();
});
socket.on('private typing', data => {
  if (!joined || !activePeer || data?.id !== activePeer.id) return;
  if (data.typing) typingUsers.set(data.id, data.name); else typingUsers.delete(data.id);
  updateTyping();
});
renderHeader();
if (name) { $('profileName').textContent = name; $('profileAvatar').textContent = name[0].toUpperCase(); $('nameOverlay').classList.add('hidden'); }
else showLogin();
