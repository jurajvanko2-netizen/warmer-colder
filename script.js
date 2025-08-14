// Warmer Colder v7 (regenerated): autosuggest, recent searches, colored deltas, 7-day hourly
const form = document.getElementById('search-form');
const input = document.getElementById('query');
const statusEl = document.getElementById('status');
const results = document.getElementById('results');
const placeTitle = document.getElementById('place');
const tbody = document.getElementById('tbody');
const suggestions = document.getElementById('suggestions');
const recentBox = document.getElementById('recent');

const RECENT_KEY = 'wc_recent_v1';
const MAX_RECENT = 10;

// ------- Autosuggest -------
let acAbort = null; let acTimer = null;
input.addEventListener('input', () => {
  const q = input.value.trim();
  if (acTimer) clearTimeout(acTimer);
  if (!q || q.length < 3) { hideSuggestions(); return; }
  acTimer = setTimeout(() => fetchSuggestions(q), 180);
});
document.addEventListener('click', (e) => {
  if (!suggestions.contains(e.target) && e.target !== input) hideSuggestions();
});
async function fetchSuggestions(q){
  try{
    if(acAbort) acAbort.abort();
    acAbort = new AbortController();
    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', q);
    url.searchParams.set('count', '5');
    url.searchParams.set('language', 'en');
    const res = await fetch(url, { signal: acAbort.signal, headers: { 'accept': 'application/json' } });
    const data = await res.json();
    renderSuggestions((data && data.results) ? data.results.slice(0,5) : []);
  }catch(e){ /* ignore */ }
}
function renderSuggestions(list){
  if (!list.length){ hideSuggestions(); return; }
  suggestions.innerHTML = '';
  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const name = [item.name, item.admin1, item.country].filter(Boolean).join(', ');
    div.innerHTML = `<span>${name}</span><span class="meta">${item.latitude.toFixed(2)}, ${item.longitude.toFixed(2)}</span>`;
    div.addEventListener('click', () => {
      input.value = name;
      hideSuggestions();
      form.requestSubmit();
    });
    suggestions.appendChild(div);
  });
  suggestions.classList.remove('hidden');
}
function hideSuggestions(){ suggestions.classList.add('hidden'); }

// ------- Recent searches -------
function loadRecent(){
  try{
    const j = localStorage.getItem(RECENT_KEY);
    return j ? JSON.parse(j) : [];
  }catch{ return []; }
}
function saveRecent(name){
  let arr = loadRecent();
  const lower = name.toLowerCase();
  arr = arr.filter(n => n.toLowerCase() !== lower);
  arr.unshift(name);
  if (arr.length > MAX_RECENT) arr = arr.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
  renderRecent();
}
function renderRecent(){
  const arr = loadRecent();
  recentBox.innerHTML = '';
  if (!arr.length){ recentBox.classList.add('hidden'); return; }
  arr.forEach(name => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = name;
    chip.addEventListener('click', () => {
      input.value = name;
      form.requestSubmit();
    });
    recentBox.appendChild(chip);
  });
  recentBox.classList.remove('hidden');
}

// ------- Search / Fetch / Render -------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideSuggestions();
  const q = input.value.trim();
  if (!q) return;
  results.classList.add('hidden');
  tbody.innerHTML='';
  statusEl.textContent='Looking up location…';
  try{
    // Geocoding
    const geoUrl=new URL('https://geocoding-api.open-meteo.com/v1/search');
    geoUrl.searchParams.set('name', q);
    geoUrl.searchParams.set('count','1');
    geoUrl.searchParams.set('language','en');
    const geo=await fetch(geoUrl,{headers:{'accept':'application/json'}}).then(r=>r.json());
    if(!geo.results || !geo.results.length){ statusEl.textContent='No matching location found.'; return; }
    const g=geo.results[0];
    const {latitude, longitude, name, country, admin1}=g;
    statusEl.textContent='Fetching hourly data…';

    // Forecast (hourly) + 24h ago, up to 7 forecast days
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto';
    const fcUrl=new URL('https://api.open-meteo.com/v1/forecast');
    fcUrl.searchParams.set('latitude',latitude);
    fcUrl.searchParams.set('longitude',longitude);
    fcUrl.searchParams.set('timezone',tz);
    fcUrl.searchParams.set('past_days','1');
    fcUrl.searchParams.set('forecast_days','7');
    fcUrl.searchParams.set('hourly',['temperature_2m','precipitation','windspeed_10m'].join(','));

    const fc=await fetch(fcUrl,{headers:{'accept':'application/json'}}).then(r=>r.json());
    const H=fc.hourly;
    if(!H || !H.time){ statusEl.textContent='Unable to load data.'; return; }

    const times=H.time.map(t=>new Date(t));
    const toKey=(d)=>{ const dt=new Date(d); dt.setMinutes(0,0,0); return dt.toISOString(); };
    const mapTemp=new Map(), mapWind=new Map(), mapPrcp=new Map();
    for(let i=0;i<times.length;i++){ const k=toKey(times[i]); mapTemp.set(k,H.temperature_2m[i]); mapWind.set(k,H.windspeed_10m[i]); mapPrcp.set(k,H.precipitation[i]); }

    // Start at next full hour
    const now=new Date();
    const start=new Date(now); start.setMinutes(0,0,0); if(now.getMinutes()>0 || now.getSeconds()>0 || now.getMilliseconds()>0){ start.setHours(start.getHours()+1); }

    placeTitle.textContent=`${name}${admin1? ', '+admin1:''}${country? ', '+country:''}`;

    let produced=0; let currentDateKey=null;
    const MAX_HOURS = 168;
    while(produced<MAX_HOURS){
      const h=new Date(start.getTime()+produced*3600*1000);
      const key=toKey(h);
      const idx=H.time.findIndex(t=>toKey(new Date(t))===key);
      if(idx===-1){ produced++; continue; }

      const tF=H.temperature_2m[idx];
      const wF=H.windspeed_10m[idx];
      const pF=H.precipitation[idx];
      const yKey=toKey(new Date(h.getTime()-24*3600*1000));
      const tY=mapTemp.get(yKey);
      const wY=mapWind.get(yKey);
      const pY=mapPrcp.get(yKey);
      const dT=(tY!=null && tF!=null)? (tF - tY) : null;
      const dW=(wY!=null && wF!=null)? (wF - wY) : null;
      const dP=(pY!=null && pF!=null)? (pF - pY) : null;

      const dateKey=h.toLocaleDateString('en-GB',{weekday:'short', day:'2-digit', month:'2-digit'});
      if(dateKey!==currentDateKey){
        currentDateKey=dateKey;
        const section=document.createElement('div');
        section.className='row section-date';
        section.innerHTML=`
          <div class="td col-date">${dateKey}</div>
          <div class="td"></div><div class="td"></div><div class="td"></div><div class="td"></div>
        `;
        tbody.appendChild(section);
      }

      const hourLabel=h.toLocaleTimeString('en-GB',{hour:'2-digit', minute:'2-digit'});
      const tempClass = dT == null ? '' : (dT >= 0 ? 'hot' : 'cold');
      const textComp = buildRealFeel(dT, dW);

      const row=document.createElement('div');
      row.className='row';
      row.innerHTML=`
        <div class="td col-date"><div class="hour">${hourLabel}</div></div>
        <div class="td col-today">
          <div class="temp">${fmtTemp(tF)}</div>
          <div class="small">Wind: ${rd(wF)} km/h <span class="badge">Precip: ${fx(pF)} mm</span></div>
        </div>
        <div class="td col-yday">
          <div class="temp">${fmtTemp(tY)}</div>
          <div class="small">Wind: ${rd(wY)} km/h <span class="badge">Precip: ${fx(pY)} mm</span></div>
        </div>
        <div class="td col-delta">
          <div class="delta ${tempClass}">${fmtDelta(dT)}</div>
          <div class="delta-small">Wind: <span class="${clsPosNeg(dW)}">${diffStr(dW,' km/h')}</span>
Precip: <span class="${clsPosNeg(dP)}">${diffStr(dP,' mm')}</span></div>
        </div>
        <div class="td col-text"><span class="realfeel ${tempClass}">${textComp}</span></div>
      `;
      tbody.appendChild(row);
      produced++;
    }

    // Save recent and render
    saveRecent(placeTitle.textContent);

    results.classList.remove('hidden');
    statusEl.textContent='';
  }catch(err){
    console.error(err);
    statusEl.textContent='Oops, an error occurred.';
  }
});

// ------- Helpers -------
function fmtTemp(v){ return (v==null || Number.isNaN(v)) ? '—' : Math.round(v) + '°C'; }
function fmtDelta(v){
  if (v==null || Number.isNaN(v)) return '—';
  const r=Math.round(v); const sign = r>0?'+':''; return sign + r + '°C';
}
function fx(v){ return (v==null || Number.isNaN(v)) ? '—' : Number(v).toFixed(1); }
function rd(v){ return (v==null || Number.isNaN(v)) ? '—' : Math.round(v); }
function diffStr(v,suffix){ if (v==null || Number.isNaN(v)) return '—'; const s = v>0?'+':''; const val = (Math.round(v*10)/10).toFixed(1); return s + val + suffix; }
function clsPosNeg(v){ if (v==null || Number.isNaN(v) || v===0) return ''; return v>0 ? 'pos' : 'neg'; }

// Real‑feel builder
function buildRealFeel(dT, dW){
  const tText = tempText(dT);
  const wText = windText(dW);
  let parts = [];
  if (tText) parts.push(tText);
  if (wText) parts.push(wText);
  return parts.join(', ');
}
function tempText(dT){
  if (dT==null || Number.isNaN(dT)) return '';
  const th = 0.5;
  if (dT > th) return 'Warmer';
  if (dT < -th) return 'Colder';
  return 'About the same';
}
function windText(dW){
  if (dW==null || Number.isNaN(dW)) return '';
  const x = dW; // km/h difference
  if (x <= -18) return 'much less wind';
  if (x <= -8)  return 'less wind';
  if (x <= -2)  return 'slightly less wind';
  if (x <  2)   return 'about the same wind';
  if (x <  8)   return 'slightly more wind';
  if (x <  18)  return 'more wind';
  return 'much more wind';
}

// Render recent on load
renderRecent();
