// Warmer Colder v7.1 fixes
const form = document.getElementById('search-form');
const input = document.getElementById('query');
const statusEl = document.getElementById('status');
const results = document.getElementById('results');
const placeTitle = document.getElementById('place');
const tbody = document.getElementById('tbody');
const suggestions = document.getElementById('suggestions');
const recentBox = document.getElementById('recent');

const RECENT_KEY = 'wc_recent_v2'; // bump schema: store coords
const MAX_RECENT = 10;

// ------- Autosuggest (stores coords) -------
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
    const list = (data && data.results) ? data.results.slice(0,5) : [];
    renderSuggestions(list);
  }catch(e){ /* ignore */ }
}
function renderSuggestions(list){
  if (!list.length){ hideSuggestions(); return; }
  suggestions.innerHTML = '';
  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'item';
    const label = [item.name, item.admin1, item.country].filter(Boolean).join(', ');
    div.innerHTML = `<span>${label}</span><span class="meta">${item.latitude.toFixed(2)}, ${item.longitude.toFixed(2)}</span>`;
    div.addEventListener('click', () => {
      hideSuggestions();
      // Use coordinates directly to avoid geocoding mismatch
      searchByCoords(item.latitude, item.longitude, label);
    });
    suggestions.appendChild(div);
  });
  suggestions.classList.remove('hidden');
}
function hideSuggestions(){ suggestions.classList.add('hidden'); }

// ------- Recent searches (store {name, lat, lon}) -------
function loadRecent(){
  try{
    const j = localStorage.getItem(RECENT_KEY);
    return j ? JSON.parse(j) : [];
  }catch{ return []; }
}
function saveRecent(entry){
  let arr = loadRecent();
  // dedupe by name+coords
  arr = arr.filter(e => !(e.name === entry.name && e.lat === entry.lat && e.lon === entry.lon));
  arr.unshift(entry);
  if (arr.length > MAX_RECENT) arr = arr.slice(0, MAX_RECENT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(arr));
  renderRecent();
}
function renderRecent(){
  const arr = loadRecent();
  recentBox.innerHTML = '';
  if (!arr.length){ recentBox.classList.add('hidden'); return; }
  arr.forEach(e => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = e.name;
    chip.addEventListener('click', () => {
      searchByCoords(e.lat, e.lon, e.name);
    });
    recentBox.appendChild(chip);
  });
  recentBox.classList.remove('hidden');
}

// ------- Search flows -------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideSuggestions();
  const q = input.value.trim();
  if (!q) return;
  await searchByQuery(q);
});

async function searchByQuery(q){
  results.classList.add('hidden');
  tbody.innerHTML='';
  statusEl.textContent='Looking up location…';
  try{
    const geoUrl=new URL('https://geocoding-api.open-meteo.com/v1/search');
    geoUrl.searchParams.set('name', q);
    geoUrl.searchParams.set('count','1');
    geoUrl.searchParams.set('language','en');
    const geo=await fetch(geoUrl,{headers:{'accept':'application/json'}}).then(r=>r.json());
    if(!geo.results || !geo.results.length){ statusEl.textContent='No matching location found.'; return; }
    const g=geo.results[0];
    const label=[g.name,g.admin1,g.country].filter(Boolean).join(', ');
    await searchByCoords(g.latitude, g.longitude, label);
  }catch(err){
    console.error(err);
    statusEl.textContent='Oops, an error occurred.';
  }
}

async function searchByCoords(lat, lon, label){
  results.classList.add('hidden');
  tbody.innerHTML='';
  statusEl.textContent='Fetching hourly data…';
  try{
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto';
    const fcUrl=new URL('https://api.open-meteo.com/v1/forecast');
    fcUrl.searchParams.set('latitude',lat);
    fcUrl.searchParams.set('longitude',lon);
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

    const now=new Date();
    const start=new Date(now); start.setMinutes(0,0,0); if(now.getMinutes()>0 || now.getSeconds()>0 || now.getMilliseconds()>0){ start.setHours(start.getHours()+1); }

    placeTitle.textContent=label;

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
      const tempClass = dT == null ? 'temp-same' : (dT >= 0 ? 'temp-warmer' : 'temp-colder');
      const windWordClass = dW == null ? '' : (dW >= 0 ? 'wind-more' : 'wind-less');
      const textComp = buildRealFeel(dT, dW, tempClass, windWordClass);

      const row=document.createElement('div');
      row.className='row';
      row.innerHTML=`
        <div class="td col-date"><div class="hour">${hourLabel}</div></div>
        <div class="td col-today">
          <div class="temp">${fmtTemp(tF)}</div>
          <div class="small">Wind: ${rd(wF)} km/h  •  Precip: ${fx(pF)} mm</div>
        </div>
        <div class="td col-yday">
          <div class="temp">${fmtTemp(tY)}</div>
          <div class="small">Wind: ${rd(wY)} km/h  •  Precip: ${fx(pY)} mm</div>
        </div>
        <div class="td col-delta">
          <div class="delta ${dT==null?'':(dT>=0?'hot':'cold')}">${fmtDelta(dT)}</div>
          <div class="delta-small">
            Wind: <span class="${windPosNegClass(dW)}">${diffStr(dW,' km/h')}</span>\n
            Precip: <span class="${precipPosNegClass(dP)}">${diffStr(dP,' mm')}</span>
          </div>
        </div>
        <div class="td col-text">
          <span class="realfeel">
            <span class="${tempClass}">${tempText(dT)}</span>
            ${windText(dW) ? ', ' : ''}
            <span class="${windWordClass}">${windText(dW)}</span>
          </span>
        </div>
      `;
      tbody.appendChild(row);
      produced++;
    }

    // Save recent entry (with coords)
    saveRecent({ name: label, lat, lon });

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
function windPosNegClass(v){
  if (v==null || Number.isNaN(v) || v===0) return '';
  // NEG (less wind) -> green; POS (more wind) -> red
  return v>0 ? 'wind-pos' : 'wind-neg';
}
function precipPosNegClass(v){
  if (v==null || Number.isNaN(v) || v===0) return '';
  // precip: POS (more) -> green; NEG (less) -> red
  return v>0 ? 'precip-pos' : 'precip-neg';
}
function tempText(dT){
  if (dT==null || Number.isNaN(dT)) return 'About the same';
  const th = 0.5;
  if (dT > th) return 'Warmer';
  if (dT < -th) return 'Colder';
  return 'About the same';
}
function windText(dW){
  if (dW==null || Number.isNaN(dW)) return '';
  const x = dW;
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
