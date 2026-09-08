export const validRoomId = value => /^[0-9a-f]{6}$/i.test(value || '') ? value.toUpperCase() : null;

export function roomInviteUrl(base, roomId) {
  try {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    const server=url.searchParams.get('server');
    url.pathname = url.pathname.endsWith('/')?url.pathname:url.pathname.replace(/[^/]*$/,''); url.search = ''; url.hash = '';
    url.searchParams.set('multiplayer', '1');
    if (validRoomId(roomId)) url.searchParams.set('room', validRoomId(roomId));
    if(server){try{const endpoint=new URL(server);if(endpoint.protocol==='https:'&&endpoint.hostname.endsWith('.trycloudflare.com')&&!endpoint.username&&!endpoint.password)url.searchParams.set('server',endpoint.origin);}catch{}}
    return url.href;
  } catch { return ''; }
}

export function isLocalAddress(address) {
  try {
    const h = new URL(address).hostname.toLowerCase();
    return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|\[f[cd]|\[fe80)/.test(h) || h.endsWith('.local');
  } catch { return true; }
}

export function inviteAddresses(serverUrls, pageUrl, roomId) {
  // Prefer the server's complete invitation so a friend can connect directly
  // without another cold request for the hosting site's runtime configuration.
  const candidates = [...(serverUrls || []), ...(!isLocalAddress(pageUrl) ? [pageUrl] : [])];
  return [...new Set(candidates.map(base => roomInviteUrl(base, roomId)).filter(Boolean))]
    .sort((a, b) => Number(isLocalAddress(a)) - Number(isLocalAddress(b)));
}
