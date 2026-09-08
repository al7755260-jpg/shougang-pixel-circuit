export function createScreenControls(root,notify){
  const row=document.createElement('div');row.className='setting-row';
  row.innerHTML='<span><strong>全屏游玩</strong><small>电脑按 F 切换，获得更完整的赛道视野</small></span><button class="text-button" id="screen-fullscreen">进入全屏</button>';
  root.querySelector('#settings-done').before(row);
  const button=row.querySelector('button');
  async function toggle(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else notify('此浏览器请使用“添加到主屏幕”获得全屏体验。');}catch{notify('暂时无法进入全屏，请在浏览器中打开游戏。');}}
  button.onclick=toggle;
  document.addEventListener('fullscreenchange',()=>button.textContent=document.fullscreenElement?'退出全屏':'进入全屏');
  window.addEventListener('keydown',e=>{if(e.code==='KeyF'&&!e.repeat&&!e.target.closest('input,textarea,select')&&!e.ctrlKey&&!e.metaKey&&!e.altKey){e.preventDefault();toggle();}});
}
