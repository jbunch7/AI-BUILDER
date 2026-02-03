(()=>{
const s=document.currentScript;
const id=s&&s.getAttribute('data-iframe');
const origin=s&&s.getAttribute('data-origin');
const get=()=>id?document.getElementById(id):document.querySelector('iframe');
window.addEventListener('message',e=>{
  if(origin&&e.origin!==origin) return;
  const d=e.data;
  if(!d||d.type!=='KRAKEN_VISUALIZER_RESIZE') return;
  const h=Number(d.height);
  if(!isFinite(h)||h<=0) return;
  const f=get();
  if(!f) return;
  const px=Math.ceil(h)+2;
  f.style.height=px+'px';
  f.setAttribute('height',String(px));
  f.setAttribute('scrolling','no');
});
})();
