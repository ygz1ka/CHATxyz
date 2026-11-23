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
let activeGroup = null;
let groups = [];
let profileAvatar = null;
let selectedLoginPhoto = null;
let loginPhotoObjectUrl = null;
let avatarToSaveAfterJoin = null;
let pendingAttachment = null;
let uploading = false;
let joined = false;
let joinVersion = 0;
let sending = false;
let typingTimeout;
let knownPeers = {};
let onlineUsers = [];
const renderedIds = new Set();
const typingUsers = new Map();
let typingCleanupTimer = null;
try { knownPeers = JSON.parse(localStorage.getItem('xyz-known-peers') || '{}'); } catch { knownPeers = {}; }

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('visible'), 3500);
}
function savePeers() { localStorage.setItem('xyz-known-peers', JSON.stringify(knownPeers)); }
function stopTyping() { clearTimeout(typingTimeout); if (joined && socket.connected) socket.emit('typing', false); }
function clearTyping() {
  typingUsers.clear();
  clearInterval(typingCleanupTimer);
  typingCleanupTimer = null;
  $('typing').textContent = '';
}
function updateTyping() {
  const now = Date.now();
  for (const [id, value] of typingUsers) if (value.expires < now) typingUsers.delete(id);
  const users = [...typingUsers.values()].map(value => value.name);
  const excerpt = users.slice(0, 2).join(', ') + (users.length > 2 ? ` e mais ${users.length - 2}` : '');
  $('typing').textContent = users.length ? `${excerpt} ${users.length === 1 ? 'está' : 'estão'} digitando...` : '';
  if (!users.length && typingCleanupTimer) {
    clearInterval(typingCleanupTimer); typingCleanupTimer = null;
  }
}
function receiveTyping(data) {
  if (!data?.id || typeof data.name !== 'string') return;
  if (data.typing) {
    typingUsers.set(data.id, {name:data.name, expires:Date.now() + 2400});
    if (!typingCleanupTimer) typingCleanupTimer=setInterval(updateTyping, 400);
  } else typingUsers.delete(data.id);
  updateTyping();
}
function scrollDown() { $('conversation').scrollTop = $('conversation').scrollHeight; }
function addSystem(text) {
  if (activePeer) return;
  const el = document.createElement('div'); el.className = 'system-message'; el.textContent = text;
  $('messages').appendChild(el); scrollDown();
}
function setAvatar(el, nameText, url) {
  el.textContent = (nameText || '?')[0].toUpperCase();
  el.style.backgroundImage = '';
  if (typeof url === 'string' && /^\/uploads\/[0-9a-f-]{36}$/.test(url)) {
    el.textContent = '';
    el.style.backgroundImage = `url("${url}")`;
  }
}
function syncGroups(next) { if (Array.isArray(next)) groups = next; renderGroups(); }
function renderGroups() {
  const list=$('groupList'); list.replaceChildren();
  if (!groups.length) { const el=document.createElement('span'); el.className='private-help'; el.textContent='Crie um grupo para conversar com a equipe.'; list.append(el); }
  for (const g of groups) {
    const btn=document.createElement('button');btn.type='button';btn.className='private-contact'+(activeGroup?.id===g.id?' active':'');
    btn.append(window.conectaIcon('users'),document.createTextNode(g.name));btn.addEventListener('click',()=>openGroup(g));list.append(btn);
  }
}
function isMyMessage(data) {
  // Identidade persistente no navegador permite alinhar inclusive o histórico anterior.
  if (data.senderClientId === clientId) return true;
  if (data.private || data.group || data.senderClientId) return false;
  // Mensagens públicas antigas podem ter um ID de sessão anterior.
  // Se houver outro usuário online com o mesmo nome, evitamos atribuição incorreta.
  const otherWithSameName = onlineUsers.some(u => u.id !== clientId && u.name === name);
  return !otherWithSameName && data.name === name;
}
function messageFits(data) {
  if (!data || typeof data.message !== 'string') return false;
  if (activeGroup) return data.group === true && data.groupId === activeGroup.id;
  if (activePeer) return data.private === true &&
    ((data.senderClientId === clientId && data.recipientId === activePeer.id) ||
     (data.senderClientId === activePeer.id && data.recipientId === clientId));
  return !data.private && !data.group && data.roomId === activeRoom;
}
function addMessage(data) {
  if (!messageFits(data) || !data.name || (data.id && renderedIds.has(data.id))) return;
  if (data.id) renderedIds.add(data.id);
  const mine = isMyMessage(data);
  const row = document.createElement('div'); row.className = 'message' + (mine ? ' self' : '');
  const avatar = document.createElement('div'); avatar.className = 'avatar'; setAvatar(avatar, data.name, data.avatar || onlineUsers.find(u=>u.id===data.senderClientId)?.avatar);
  const body = document.createElement('div'); body.className = 'message-body';
  const meta = document.createElement('div'); meta.className = 'message-meta';
  const author = document.createElement('strong'); author.textContent = mine ? 'Você' : data.name;
  const time = document.createElement('time'); const date = new Date(data.time);
  time.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const message = document.createElement('div'); message.className = 'message-text'; message.textContent = data.message;
  meta.append(author, time); body.append(meta, message);
  if(data.attachment && /^\/uploads\/[0-9a-f-]{36}$/.test(data.attachment.url || '')) {
    if ((data.attachment.mime || '').startsWith('image/')) {
      const button=document.createElement('button');button.type='button';button.className='image-open';button.setAttribute('aria-label','Ampliar imagem sem sair do chat');
      const img=document.createElement('img');img.className='message-image';img.src=data.attachment.url;img.alt=data.attachment.filename||'Imagem anexada';img.loading='lazy';button.append(img);button.addEventListener('click',()=>openImage(data.attachment.url, data.attachment.filename));body.append(button);
    } else if ((data.attachment.mime || '').startsWith('audio/')) {
      const audio=document.createElement('audio');audio.className='message-audio';audio.controls=true;audio.preload='none';audio.src=data.attachment.url;audio.setAttribute('aria-label','Mensagem de voz de '+data.name);body.append(audio);
    } else {
      const a=document.createElement('a');a.className='message-file';a.href=data.attachment.url;a.download=data.attachment.filename||'arquivo';a.append(window.conectaIcon('file-text'),document.createTextNode(data.attachment.filename||'Baixar arquivo'));body.append(a);
    }
  }
  row.append(avatar, body);
  $('messages').appendChild(row); scrollDown();
}
function renderHeader() {
  if (activeGroup) {
    $('channelIcon').replaceChildren(window.conectaIcon('users'));
    $('channelTitle').textContent=activeGroup.name;
    $('channelSubtitle').textContent='Grupo • '+activeGroup.members.length+' participantes';
    $('welcomeTitle').textContent=activeGroup.name;
    $('welcomeText').textContent='Conversa compartilhada entre os participantes do grupo.';
    $('messageInput').placeholder='Mensagem para '+activeGroup.name;
  } else if (activePeer) {
    $('channelIcon').replaceChildren(window.conectaIcon('message-circle'));
    $('channelTitle').textContent = activePeer.name;
    $('channelSubtitle').textContent = onlineUsers.some(u => u.id === activePeer.id) ? 'Conversa privada • online' : 'Conversa privada • offline';
    $('welcomeTitle').textContent = activePeer.name;
    $('welcomeText').textContent = 'Esta é uma conversa privada. Somente os dois participantes recebem as mensagens pelo chat.';
    $('messageInput').placeholder = `Mensagem privada para ${activePeer.name}`;
  } else {
    const room = rooms[activeRoom];
    $('channelIcon').replaceChildren(window.conectaIcon('hash'));
    $('channelTitle').textContent = room.name;
    $('channelSubtitle').textContent = room.description;
    $('welcomeTitle').textContent = '# ' + room.name;
    $('welcomeText').textContent = `Este é o começo do canal #${room.name}. Compartilhe uma ideia ou diga olá para a equipe!`;
    $('messageInput').placeholder = `Enviar mensagem para #${room.name}`;
  }
  document.querySelectorAll('.room').forEach(button => button.classList.toggle('active', !activePeer && !activeGroup && button.dataset.room === activeRoom));
  renderPrivateList(); renderGroups();
}
function renderMembers(users) {
  $('onlineCount').textContent = users.length;
  $('membersCount').textContent = users.length;
  $('membersList').replaceChildren();
  for (const user of users) {
    const item = document.createElement('button'); item.type = 'button'; item.className = 'member member-action';
    const avatar = document.createElement('div'); avatar.className = 'avatar'; setAvatar(avatar,user.name,user.avatar);
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
    const avatar = document.createElement('span'); avatar.className = 'contact-avatar'; setAvatar(avatar,peer.name,peer.avatar || onlineUsers.find(u=>u.id===peer.id)?.avatar);
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
  const group = activeGroup ? {...activeGroup} : null;
  const roomId = activeRoom;
  joined = false;
  const event = group ? 'open group' : peer ? 'open private' : 'join room';
  const payload = group ? {groupId:group.id} : peer ? { name, clientId, peerId: peer.id, peerName: peer.name } : { name, clientId, roomId };
  socket.timeout(8000).emit(event, payload, (error, response) => {
    if (version !== joinVersion || (group ? activeGroup?.id!==group.id : peer ? activePeer?.id !== peer.id : activePeer || activeGroup || activeRoom !== roomId)) return;
    if (error || !response?.ok) { toast(response?.error || 'Não foi possível abrir a conversa.'); $('profileStatus').textContent = 'Conexão pendente'; return; }
    joined = true;
    $('profileStatus').textContent = 'Online';
    $('messages').replaceChildren(); renderedIds.clear(); clearTyping();
    setOnline(response.online || onlineUsers);
    syncGroups(response.groups);
    if (response.profile) {profileAvatar=response.profile.avatar;setAvatar($('profileAvatar'),name,profileAvatar);}
    if (avatarToSaveAfterJoin) { const avatar=avatarToSaveAfterJoin; avatarToSaveAfterJoin=null; socket.timeout(8000).emit('update profile',{avatar},(err,r)=>{if(err||!r?.ok){toast(r?.error||'Não foi possível salvar a foto.');return;}profileAvatar=avatar;setAvatar($('profileAvatar'),name,avatar);}); }
    (Array.isArray(response.history) ? response.history : []).forEach(addMessage);
    if (peer && response.peerName && peer.name !== response.peerName) { activePeer.name = response.peerName; knownPeers[peer.id] = response.peerName; savePeers(); renderHeader(); }
    scrollDown(); $('messageInput').focus();
  });
}
function setRoom(roomId) {
  if (!rooms[roomId] || (!activePeer && activeRoom === roomId && joined)) return;
  stopTyping(); activePeer = null;activeGroup=null; activeRoom = roomId; ++joinVersion; resetView(); enterCurrent();
}
function openPrivate(peer) {
  if (!peer || peer.id === clientId) return;
  stopTyping(); activeGroup=null;activePeer = {id: peer.id, name: peer.name};
  knownPeers[peer.id] = peer.name; savePeers(); ++joinVersion; resetView(); enterCurrent();
}
function openGroup(group) { if (!group?.id) return;stopTyping();activePeer=null;activeGroup={...group};++joinVersion;resetView();enterCurrent(); }
function showLogin() { $('nameInput').value = name; $('nameOverlay').classList.remove('hidden'); }
$('loginPhotoInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (loginPhotoObjectUrl) URL.revokeObjectURL(loginPhotoObjectUrl);
  loginPhotoObjectUrl=null; selectedLoginPhoto=null;
  const preview=$('loginPhotoPreview');preview.replaceChildren(window.conectaIcon('user-round'));
  if (!file) return;
  if (!['image/jpeg','image/png','image/gif','image/webp'].includes(file.type) || file.size>5*1024*1024) {
    $('nameError').textContent='Selecione uma imagem JPG, PNG, GIF ou WebP de até 5 MB.';
    event.target.value=''; return;
  }
  $('nameError').textContent='';selectedLoginPhoto=file;
  loginPhotoObjectUrl=URL.createObjectURL(file);
  const image=document.createElement('img');image.src=loginPhotoObjectUrl;image.alt='Prévia da foto escolhida';preview.replaceChildren(image);
});
$('nameForm').addEventListener('submit', async event => {
  event.preventDefault(); const next=$('nameInput').value.trim().slice(0,24);
  if(!next){$('nameError').textContent='Digite seu nome para continuar.';return;}
  if(!socket.connected){$('nameError').textContent='Sem conexão com o servidor. Tente novamente.';return;}
  const button=$('nameForm').querySelector('button[type="submit"]');
  button.disabled=true;$('nameError').textContent='';
  try {
    if (selectedLoginPhoto) {
      const uploaded=await uploadFile(selectedLoginPhoto);
      avatarToSaveAfterJoin=uploaded.url;
      selectedLoginPhoto=null;
    }
    name=next;sessionStorage.setItem('xyz-name',name);
    $('profileName').textContent=name;setAvatar($('profileAvatar'),name,avatarToSaveAfterJoin||profileAvatar);
    $('nameOverlay').classList.add('hidden');enterCurrent();
  } catch(error) { $('nameError').textContent=error.message||'Não foi possível enviar a foto.'; }
  finally {button.disabled=false;}
});
$('editName').addEventListener('click', showLogin);
$('roomList').addEventListener('click', event => { const btn = event.target.closest('[data-room]'); if (btn) setRoom(btn.dataset.room); });
$('messageForm').addEventListener('submit', event => {
  event.preventDefault(); const message = $('messageInput').value.trim();
  if (!message && !pendingAttachment) { toast('Digite uma mensagem.'); return; }
  if (!name) { showLogin(); return; }
  if (!socket.connected || !joined) { toast('Reconectando ao chat. Tente novamente.'); enterCurrent(); return; }
  if (sending || uploading) return;
  sending = true; $('messageInput').disabled = true;
  const targetPeer = activePeer?.id || null;const targetGroup=activeGroup?.id || null;const targetRoom = activeRoom;
  const attachment=pendingAttachment;
  socket.timeout(8000).emit(targetGroup ? 'group message' : targetPeer ? 'private message' : 'chat message', { message,attachment }, (error, response) => {
    sending = false; $('messageInput').disabled = false;
    if (error || !response?.ok) toast(response?.error || 'Envio não confirmado. Confira a conversa antes de reenviar.');
    else if (targetPeer === (activePeer?.id || null) && targetGroup === (activeGroup?.id || null) && targetRoom === activeRoom && $('messageInput').value === message) {
      $('messageInput').value = ''; pendingAttachment=null;renderAttachmentPreview();stopTyping();
    }
    $('messageInput').focus();
  });
});
$('messageInput').addEventListener('input', () => {
  if (!joined) return;
  socket.emit('typing', Boolean($('messageInput').value.trim()));
  clearTimeout(typingTimeout); typingTimeout = setTimeout(() => { if(socket.connected) socket.emit('typing', false); }, 1100);
});
$('messageInput').addEventListener('blur', stopTyping);
window.addEventListener('pagehide', stopTyping);
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
socket.on('group message', addMessage);
socket.on('groups updated', syncGroups);
socket.on('profile updated', data=>{if(data.id===clientId){profileAvatar=data.avatar;setAvatar($('profileAvatar'),name,profileAvatar);}onlineUsers=onlineUsers.map(u=>u.id===data.id?{...u,avatar:data.avatar}:u);renderMembers(onlineUsers);renderPrivateList();});
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
  receiveTyping(data);
});
socket.on('group typing',data=>{if(!joined||!activeGroup)return;receiveTyping(data);});
socket.on('private typing', data => {
  if (!joined || !activePeer || data?.id !== activePeer.id) return;
  receiveTyping(data);
});
// Imagens abrem por cima da conversa, sem criar outra guia.
function openImage(url, filename) {
  if (!/^\/uploads\/[0-9a-f-]{36}$/.test(url)) return;
  $('lightboxImage').src=url;
  $('lightboxCaption').textContent=filename || 'Imagem';
  $('imageLightbox').hidden=false;
  $('lightboxClose').focus();
}
function closeImage() { $('imageLightbox').hidden=true; $('lightboxImage').removeAttribute('src'); }
$('lightboxClose').addEventListener('click',closeImage);
$('imageLightbox').addEventListener('click',e=>{if(e.target===$('imageLightbox'))closeImage();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('imageLightbox').hidden)closeImage();});

// Mensagens de voz (não chamadas ao vivo): gravar, parar e preparar envio.
let recorder=null, recordingStream=null, audioChunks=[], recordingStarted=0, recordingTimer=null, recordingLimit=null;
let cancellingRecording=false;
function recordingUI(active) {
  $('recordButton').classList.toggle('recording',active);
  $('recordButton').setAttribute('aria-pressed',String(active));
  $('recordButton').replaceChildren(window.conectaIcon(active?'x':'mic'));
  $('recordButton').title=active?'Parar gravação':'Gravar áudio';
  $('recordingStatus').hidden=!active;
}
function stopMediaTracks() {
  clearInterval(recordingTimer);clearTimeout(recordingLimit);
  if(recordingStream){recordingStream.getTracks().forEach(track=>track.stop());recordingStream=null;}
}
async function toggleRecording() {
  if(recorder?.state==='recording') { recorder.stop();return; }
  if(uploading||sending) return toast('Aguarde o envio atual.');
  if(!name||!joined) return toast('Entre na conversa antes de gravar.');
  if(pendingAttachment) return toast('Envie ou remova o anexo atual antes de gravar.');
  if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')return toast('Microfone indisponível. Use localhost ou HTTPS e um navegador compatível.');
  let stream;
  try { stream=await navigator.mediaDevices.getUserMedia({audio:true}); }
  catch(err) {return toast(err.name==='NotAllowedError'?'Permita o acesso ao microfone nas configurações do navegador.':'Não foi possível acessar o microfone.');}
  const types=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
  const selected=types.find(t=>MediaRecorder.isTypeSupported(t));
  if(!selected){stream.getTracks().forEach(t=>t.stop());return toast('Gravação de áudio não é suportada neste navegador.');}
  recordingStream=stream; audioChunks=[]; cancellingRecording=false;
  try{recorder=new MediaRecorder(stream,{mimeType:selected});}
  catch { stopMediaTracks();return toast('Falha ao iniciar gravação.'); }
  const current=recorder;
  current.ondataavailable=e=>{if(e.data?.size)audioChunks.push(e.data);};
  current.onerror=()=>{cancellingRecording=true;toast('Falha na gravação.');try{current.stop();}catch{stopMediaTracks();recordingUI(false);}};
  current.onstop=async()=>{
    stopMediaTracks();recordingUI(false);
    if(cancellingRecording){audioChunks=[];return;}
    const blob=new Blob(audioChunks,{type:selected.split(';')[0]});audioChunks=[];
    if(!blob.size)return toast('O áudio ficou vazio. Tente novamente.');
    if(blob.size>5*1024*1024)return toast('Áudio maior que 5 MB. Grave uma mensagem mais curta.');
    const ext=blob.type==='audio/mp4'?'m4a':blob.type==='audio/ogg'?'ogg':'webm';
    const file=new File([blob],'audio-'+Date.now()+'.'+ext,{type:blob.type});
    uploading=true;toast('Preparando mensagem de voz...');
    try{pendingAttachment=await uploadFile(file);renderAttachmentPreview();toast('Áudio pronto! Clique em enviar.');}
    catch(err){toast(err.message);}finally{uploading=false;}
  };
  try {current.start(250);}catch {stopMediaTracks();recordingUI(false);return toast('Não foi possível iniciar a gravação.');}
  recordingStarted=Date.now();recordingUI(true);
  recordingTimer=setInterval(()=>{$('recordingText').textContent='Gravando áudio • '+Math.floor((Date.now()-recordingStarted)/1000)+'s (máx. 45s)';},500);
  recordingLimit=setTimeout(()=>{if(current.state==='recording')current.stop();},45000);
};
$('recordButton').addEventListener('click',toggleRecording);
$('cancelRecording').addEventListener('click',()=>{if(recorder?.state==='recording'){cancellingRecording=true;recorder.stop();}});

// Ferramentas de anexos, emojis, grupos e perfis.
function renderAttachmentPreview(){const el=$('attachmentPreview');el.replaceChildren();el.hidden=!pendingAttachment;if(!pendingAttachment)return;const label=document.createElement('span');label.append(window.conectaIcon('paperclip'),document.createTextNode(pendingAttachment.filename));const remove=document.createElement('button');remove.type='button';remove.append(window.conectaIcon('x'));remove.title='Remover anexo';remove.onclick=()=>{pendingAttachment=null;renderAttachmentPreview();};el.append(label,remove);}
async function uploadFile(file){
  if(!file)return null;
  if(file.size>5*1024*1024)throw Error('O limite por arquivo é 5 MB.');
  const mime=file.type || ({'.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','.zip':'application/zip'}[file.name.slice(file.name.lastIndexOf('.')).toLowerCase()]);
  if(!mime)throw Error('Tipo de arquivo não permitido.');
  const response=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-File-Type':mime,'X-File-Name':encodeURIComponent(file.name.slice(0,100))},body:file});
  const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Falha no upload.');return data.attachment;
}
$('attachButton').onclick=()=>$('attachmentInput').click();
$('attachmentInput').onchange=async()=>{const file=$('attachmentInput').files[0];$('attachmentInput').value='';if(!file)return;uploading=true;toast('Enviando anexo...');try{pendingAttachment=await uploadFile(file);renderAttachmentPreview();toast('Anexo pronto para enviar.');}catch(err){toast(err.message);}finally{uploading=false;}};
$('editPhoto').onclick=()=>$('avatarInput').click();
$('avatarInput').onchange=async()=>{const file=$('avatarInput').files[0];$('avatarInput').value='';if(!file||!name)return;if(!file.type.startsWith('image/'))return toast('Escolha uma imagem.');try{const uploaded=await uploadFile(file);socket.timeout(8000).emit('update profile',{avatar:uploaded.url},(err,r)=>{if(err||!r?.ok)return toast(r?.error||'Não foi possível atualizar a foto.');profileAvatar=uploaded.url;setAvatar($('profileAvatar'),name,profileAvatar);toast('Foto atualizada!');});}catch(err){toast(err.message);}};
const emojiList='😀 😁 😂 🤣 😊 😍 🥰 😎 😢 😭 😡 👍 👎 👏 🙌 ❤️ 💜 💙 💚 🔥 🎉 ✅ 🚀 🤝 👀 💻 📷 🤔 🙏 😅 🤩'.split(' ');
for(const emoji of emojiList){const btn=document.createElement('button');btn.type='button';btn.textContent=emoji;btn.onclick=()=>{const input=$('messageInput');const start=input.selectionStart,end=input.selectionEnd;input.value=input.value.slice(0,start)+emoji+input.value.slice(end);input.focus();input.setSelectionRange(start+emoji.length,start+emoji.length);$('emojiPicker').hidden=true;input.dispatchEvent(new Event('input'));};$('emojiPicker').append(btn);}
$('emojiButton').onclick=()=>$('emojiPicker').hidden=!$('emojiPicker').hidden;
$('createGroup').onclick=()=>{const root=$('groupPeople');root.replaceChildren();for(const user of onlineUsers.filter(u=>u.id!==clientId)){const label=document.createElement('label');const check=document.createElement('input');check.type='checkbox';check.value=user.id;label.append(check,document.createTextNode(' '+user.name));root.append(label);}if(!root.children.length){root.textContent='Convide alguém para ficar online antes de criar o grupo.';}$('groupOverlay').classList.remove('hidden');};
$('cancelGroup').onclick=()=>$('groupOverlay').classList.add('hidden');
$('groupForm').onsubmit=event=>{event.preventDefault();const groupName=$('groupName').value.trim();const members=[...$('groupPeople').querySelectorAll('input:checked')].map(el=>el.value);socket.timeout(8000).emit('create group',{name:groupName,members},(err,r)=>{if(err||!r?.ok)return toast(r?.error||'Não foi possível criar o grupo.');$('groupOverlay').classList.add('hidden');$('groupName').value='';openGroup(r.group);toast('Grupo criado!');});};
renderHeader();
if (name) { $('profileName').textContent = name; setAvatar($('profileAvatar'),name,profileAvatar); $('nameOverlay').classList.add('hidden'); }
else showLogin();
