// Ícones SVG locais, sem CDN e sem emojis nos botões.
(() => {
  const paths = {
    'sparkles':'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 18l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 18v4M17 20h4"/>',
    'chevron-down':'<path d="m6 9 6 6 6-6"/>',
    'plus':'<path d="M12 5v14M5 12h14"/>',
    'message-circle':'<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8A8.5 8.5 0 0 1 12.5 20a8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5 8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5Z"/>',
    'pencil':'<path d="m16 5 3 3M4 20l4.5-1 11-11a2.1 2.1 0 0 0-3-3l-11 11L4 20Z"/>',
    'camera':'<path d="M14.5 4h-5L7.8 6H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.8L14.5 4Z"/><circle cx="12" cy="13" r="3.3"/>',
    'menu':'<path d="M4 6h16M4 12h16M4 18h16"/>',
    'users':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    'x':'<path d="M18 6 6 18M6 6l12 12"/>',
    'paperclip':'<path d="m21.4 11.6-8.8 8.8a6 6 0 0 1-8.5-8.5l9.6-9.6a4 4 0 0 1 5.7 5.7l-9.6 9.6a2 2 0 0 1-2.8-2.8l8.8-8.8"/>',
    'mic':'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    'smile':'<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
    'send':'<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    'arrow-right':'<path d="M5 12h14m-6-6 6 6-6 6"/>',
    'user-round':'<circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/>',
    'file-text':'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
    'hash':'<path d="M5 9h14M4 15h14M11 3 7 21M17 3l-4 18"/>',
    'check':'<path d="m5 12 4 4L19 6"/>'
  };
  function create(name) {
    const template=document.createElement('template');
    template.innerHTML=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]||paths['sparkles']}</svg>`;
    return template.content.firstElementChild;
  }
  function mount(root=document) {
    root.querySelectorAll('[data-icon]').forEach(el => {const svg=create(el.dataset.icon);el.replaceChildren(svg);el.classList.add('svg-icon');});
  }
  window.conectaIcon=create;
  window.mountConectaIcons=mount;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>mount());else mount();
})();
