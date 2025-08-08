// v6: extend to 7 days (168 hours)
const form = document.getElementById('search-form');
const input = document.getElementById('query');
const statusEl = document.getElementById('status');
const results = document.getElementById('results');
const placeTitle = document.getElementById('place');
const tbody = document.getElementById('tbody');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
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

    // Forecast (hourly) + yesterday, up to 7 forecast days
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone || 'auto';
    const fcUrl=new URL('https://api.open-meteo.com/v1/forecast');
    fcUrl.searchParams.set('latitude',latitude);
    fcUrl.searchParams.set('longitude',longitude);
    fcUrl.searchParams.set('timezone',tz);
    fcUrl.searchParams.set('past_days','1');
    fcUrl.searchParams.set('forecast_days','7'); // 7-day hourly
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
    const MAX_HOURS = 168; // 7 days
    while(produced<MAX_HOURS){
      const h=new Date(start.getTime()+produced*3600*1000);
      const key=toKey(h);
      const idx=H.time.findIndex(t=>toKey(new Date(t))===key);
      if(idx===-1){ produced++; continue; }

      const tT=H.temperature_2m[idx];
      const wT=H.windspeed_10m[idx];
      const pT=H.precipitation[idx];
      const yKey=toKey(new Date(h.getTime()-24*3600*1000));
      const tY=mapTemp.get(yKey);
      const wY=mapWind.get(yKey);
      const pY=mapPrcp.get(yKey);
      const dT=(tY!=null && tT!=null)? (tT - tY) : null;
      const dW=(wY!=null && wT!=null)? (wT - wY) : null;
      const dP=(pY!=null && pT!=null)? (pT - pY) : null;

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
      const deltaClass = dT == null ? '' : (dT >= 0 ? 'hot' : 'cold');
      const textComp = diffText(dT);

      const row=document.createElement('div');
      row.className='row';
      row.innerHTML=`
        <div class="td col-date"><div class="hour">${hourLabel}</div></div>
        <div class="td col-today">
          <div class="temp">${fmtTemp(tT)}</div>
          <div class="small">Wind: ${rd(wT)} km/h <span class="badge">Precip: ${fx(pT)} mm</span></div>
        </div>
        <div class="td col-yday">
          <div class="temp">${fmtTemp(tY)}</div>
          <div class="small">Wind: ${rd(wY)} km/h <span class="badge">Precip: ${fx(pY)} mm</span></div>
        </div>
        <div class="td col-delta">
          <div class="delta ${deltaClass}">${fmtDelta(dT)}</div>
          <div class="delta-small">Wind: ${diffStr(dW,' km/h')}
Precip: ${diffStr(dP,' mm')}</div>
        </div>
        <div class="td col-text">${textComp}</div>
      `;
      tbody.appendChild(row);
      produced++;
    }

    results.classList.remove('hidden');
    statusEl.textContent='';
  }catch(err){
    console.error(err);
    statusEl.textContent='Oops, an error occurred.';
  }
});

function fmtTemp(v){ return (v==null || Number.isNaN(v)) ? '—' : Math.round(v) + '°C'; }
function fmtDelta(v){
  if (v==null || Number.isNaN(v)) return '—';
  const r=Math.round(v); const sign = r>0?'+':''; return sign + r + '°C';
}
function fx(v){ return (v==null || Number.isNaN(v)) ? '—' : Number(v).toFixed(1); }
function rd(v){ return (v==null || Number.isNaN(v)) ? '—' : Math.round(v); }
function diffStr(v,suffix){ if (v==null || Number.isNaN(v)) return '—'; const s = v>0?'+':''; const val = (Math.round(v*10)/10).toFixed(1); return s + val + suffix; }
function diffText(dT){
  if (dT==null || Number.isNaN(dT)) return '—';
  const th=0.5;
  if (dT > th) return 'Warmer';
  if (dT < -th) return 'Colder';
  return 'About the same';
}
