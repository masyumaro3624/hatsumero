'use strict';

// Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase, ref, set, push, remove, onValue, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-analytics.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAbvx55aq5HRRDMOykXbfCdyNVcygjqjlE",
  authDomain: "hatsumero-81698.firebaseapp.com",
  databaseURL: "https://hatsumero-81698-default-rtdb.firebaseio.com",
  projectId: "hatsumero-81698",
  storageBucket: "hatsumero-81698.firebasestorage.app",
  messagingSenderId: "719614016527",
  appId: "1:719614016527:web:e02fc91b0c72453e14377a",
  measurementId: "G-CZVRHCRN6H"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const database = getDatabase(app);

let currentStationId = null;
let stationsData = [];
let chartsMap = {};
let dataCache = {
  observations: {},
  melodies: {}
};

// Firebase Data Store
class FirebaseDataStore {
  constructor(db) {
    this.db = db;
    this.observationsRef = ref(db, 'observations');
    this.melodiesRef = ref(db, 'melodies');
    this.listeners = new Map();
  }

  async init() {
    // リアルタイムリスナーを設定
    onValue(this.observationsRef, (snapshot) => {
      const data = snapshot.val();
      dataCache.observations = data || {};
      this.notifyListeners('observations_updated');
    });

    onValue(this.melodiesRef, (snapshot) => {
      const data = snapshot.val();
      dataCache.melodies = data || {};
      this.notifyListeners('melodies_updated');
    });

    return true;
  }

  async addObservation(obs) {
    const newObsRef = push(this.observationsRef);
    obs.id = newObsRef.key;
    obs.created_at = new Date().toISOString();
    await set(newObsRef, obs);
    return obs.id;
  }

  async deleteObservation(id) {
    const obsRef = ref(this.db, `observations/${id}`);
    await remove(obsRef);
  }

  async saveMelody(melody) {
    const key = `${melody.station_id}_${melody.platform}`;
    const melodyRef = ref(this.db, `melodies/${key}`);
    melody.updated_at = new Date().toISOString();
    await set(melodyRef, melody);
  }

  getObservationsByStation(stationId) {
    const observations = [];
    for (const key in dataCache.observations) {
      const obs = dataCache.observations[key];
      if (obs.station_id === stationId) {
        observations.push({ ...obs, id: key });
      }
    }
    return observations;
  }

  getMelody(stationId, platform) {
    const key = `${stationId}_${platform}`;
    return dataCache.melodies[key] || null;
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  notifyListeners(event) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb());
    }
  }

  async exportJSON() {
    const snapshot = await get(ref(this.db, '/'));
    const data = snapshot.val();
    return JSON.stringify({
      observations: data?.observations || {},
      melodies: data?.melodies || {},
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  async importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      if (data.observations) {
        for (const key in data.observations) {
          const obsRef = ref(this.db, `observations/${key}`);
          await set(obsRef, data.observations[key]);
        }
      }
      
      if (data.melodies) {
        for (const key in data.melodies) {
          const melRef = ref(this.db, `melodies/${key}`);
          await set(melRef, data.melodies[key]);
        }
      }
      
      return true;
    } catch(e) {
      console.error('Import error:', e);
      return false;
    }
  }
}

const dataStore = new FirebaseDataStore(database);

// ユーティリティ関数
function log(...a){ console.log('[app]', ...a); }
function escapeHtml(s){ if(s==null) return ''; return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function isoLocalDatetime(dt){ const pad=n=>String(n).padStart(2,'0'); return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`; }
function toISOStringFromLocalInput(val){ if(!val) return null; const d=new Date(val); if(isNaN(d.getTime())) return null; return d.toISOString(); }

function showToast(msg, ms=2000){ 
  let t=document.getElementById('toast'); 
  if(!t){ t=document.createElement('div'); t.id='toast'; Object.assign(t.style,{position:'fixed',right:'16px',bottom:'16px',padding:'12px 16px',background:'rgba(0,0,0,0.85)',color:'#fff',borderRadius:'8px',zIndex:9998,fontSize:'14px'}); document.body.appendChild(t);} 
  t.textContent=msg; t.style.display='block'; clearTimeout(t._hideTimer); t._hideTimer = setTimeout(()=> t.style.display='none', ms); 
}

function setButtonLoading(btn, loading=true){ 
  if(!btn) return; 
  if(loading){ btn.dataset.origText = btn.textContent; btn.textContent='処理中...'; btn.disabled=true; } 
  else { if(btn.dataset.origText) btn.textContent=btn.dataset.origText; btn.disabled=false; } 
}

function wilson_interval(k, n, z = 1.96) {
  if (n === 0) return [0.0, 0.0];
  const phat = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (phat + z2 / (2*n)) / denom;
  const margin = z * Math.sqrt((phat*(1-phat)/n) + z2/(4*n*n)) / denom;
  return [Math.max(0.0, center - margin), Math.min(1.0, center + margin)];
}

async function loadStationsFromCSV() {
  try {
    const response = await fetch('./stops.txt');
    if (!response.ok) throw new Error('stops.txt が見つかりません');
    
    const stopsData = await response.text();
    const lines = stopsData.trim().split('\n');
    const header = lines[0].split(',');
    const stopIdIdx = header.indexOf('stop_id');
    const stopNameIdx = header.indexOf('stop_name');
    const stopLatIdx = header.indexOf('stop_lat');
    const stopLonIdx = header.indexOf('stop_lon');

    stationsData = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i].split(',');
      if (cols.length < stopNameIdx + 1) continue;

      const stop_id = cols[stopIdIdx] ? cols[stopIdIdx].trim() : '';
      const station_name = cols[stopNameIdx] ? cols[stopNameIdx].trim() : '';
      const lat = stopLatIdx >= 0 && cols[stopLatIdx] ? parseFloat(cols[stopLatIdx]) : null;
      const lon = stopLonIdx >= 0 && cols[stopLonIdx] ? parseFloat(cols[stopLonIdx]) : null;

      if (stop_id && station_name) {
        stationsData.push({ id: i, stop_id, station_name, lat, lon });
      }
    }
    
    stationsData.sort((a, b) => a.station_name.localeCompare(b.station_name, 'ja'));
    log(`${stationsData.length}件の駅を読み込みました`);
    renderStationList();
  } catch(err) {
    log('stops.txt 読み込みエラー:', err);
    showToast('駅データの読み込みに失敗しました');
  }
}

function renderStationList(filterText = ''){
  const list=document.getElementById('stationList');
  let filtered = stationsData;
  
  if(filterText){
    filtered = stationsData.filter(s => s.station_name.includes(filterText));
  }
  
  if(filtered.length === 0){
    list.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted)">駅が見つかりません</div>';
    return;
  }
  
  list.innerHTML = filtered.map(s=> 
    `<div class="station-option" data-id="${s.id}" onclick="selectStation(${s.id},'${escapeHtml(s.station_name)}')">${escapeHtml(s.station_name)}</div>`
  ).join('');
}

window.selectStation = async function(id, name){
  currentStationId = id;
  document.querySelectorAll('.station-option').forEach(el => el.classList.remove('active'));
  const el = document.querySelector(`[data-id="${id}"]`);
  if(el) el.classList.add('active');
  await showStats();
}

function detect_anomaly(choruses) {
  if (choruses > 500) {
    return [true, "不自然なコーラス数です"];
  }
  return [false, ""];
}

async function submitForm(e){
  e.preventDefault();
  const btn=document.querySelector('#obsForm button[type=submit]');
  try{
    if(!currentStationId) { alert('駅を選んでください'); return; }
    const platform = Number(document.getElementById('platform').value);
    const choruses = Number(document.getElementById('choruses').value);
    const reported_at_val = document.getElementById('reported_at').value;
    const destination = document.getElementById('destination').value.trim() || null;
    const note = document.getElementById('note').value.trim() || null;

    if(Number.isNaN(platform) || platform < 1){ alert('番線は1以上の整数で入力してください'); return; }
    if(Number.isNaN(choruses) || choruses < 0){ alert('コーラス数は0以上で入力してください'); return; }

    const [is_anomaly, msg] = detect_anomaly(choruses);
    if (is_anomaly) {
      showToast('✗ ' + msg);
      return;
    }

    const obs = {
      station_id: currentStationId,
      platform,
      choruses,
      reported_at: toISOStringFromLocalInput(reported_at_val),
      destination,
      note,
      token: Math.random().toString(36).substr(2, 16)
    };

    setButtonLoading(btn, true);
    const obsId = await dataStore.addObservation(obs);
    localStorage.setItem('melody_token_' + obsId, obs.token);
    showToast('✓ 投稿しました（リアルタイム同期中...）');
    document.getElementById('choruses').value='0';
    document.getElementById('note').value='';
    document.getElementById('destination').value='';
    document.getElementById('reported_at').value = isoLocalDatetime(new Date());
  }catch(err){
    log('submitForm',err);
    showToast('エラーが発生しました');
  }finally{
    setButtonLoading(btn, false);
  }
}

function formatTime(iso){
  try{
    const d=new Date(iso);
    const pad=n=>String(n).padStart(2,'0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }catch(e){ return iso; }
}

window.deleteObservation = async function(obsId){
  const token = localStorage.getItem('melody_token_' + obsId);
  if(!token){
    showToast('削除権限がありません');
    return;
  }
  if(!confirm('この投稿を削除しますか？')){
    return;
  }
  try{
    await dataStore.deleteObservation(obsId);
    localStorage.removeItem('melody_token_' + obsId);
    showToast('削除しました');
    await showStats();
  }catch(err){
    log('deleteObservation',err);
  }
}

window.saveMelodyName = async function(platform){
  const melodyName = prompt('メロディー名を入力してください（例: ジングルベル）');
  if(!melodyName) return;
  
  try{
    await dataStore.saveMelody({
      station_id: currentStationId,
      platform: Number(platform),
      melody_name: melodyName
    });
    showToast('メロディー情報を保存しました');
    await showStats();
  }catch(err){
    log('saveMelodyName',err);
  }
}

window.openModal = function(platNum, latest){
  const modal = document.getElementById('detailsModal');
  const body = document.getElementById('modalBody');
  document.getElementById('modalTitle').textContent = `番線 ${platNum} — 直近5件の観測`;

  let html = '';
  html += '<h4 style="margin-top:0;margin-bottom:12px">📅 直近の投稿</h4>';
  html += '<div style="margin-bottom:16px">';
  latest.forEach(o=>{
    const time = o.reported_at ? formatTime(o.reported_at) : '時刻未記録';
    const dest = o.destination || '行き先未記録';
    const isSuccess = o.choruses >= 1.0;
    html += `<div class="obs-item ${isSuccess?'success':'fail'}">
      <div class="obs-info">
        <div class="obs-time">${escapeHtml(time)}</div>
        <div class="obs-dest">${escapeHtml(dest)}</div>
        <div class="obs-chorus">${o.choruses} コーラス ${isSuccess?'✓ 成功':'✗ 失敗'}</div>
        ${o.note?`<div style="color:var(--muted);font-size:12px">メモ: ${escapeHtml(o.note)}</div>`:''}
      </div>
      <button class="obs-delete" onclick="deleteObservation('${o.id}')">削除</button>
    </div>`;
  });
  html += '</div>';

  body.innerHTML = html;
  modal.classList.add('active');
}

window.closeModal = function(){
  document.getElementById('detailsModal').classList.remove('active');
}

function renderHourlyChart(platNum, hourly_map) {
  const chartId = `chart-${platNum}`;
  const canvas = document.getElementById(chartId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const hours = Object.keys(hourly_map).sort();
  const labels = hours.map(h => {
    const d = new Date(h);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:00`;
  });
  const data = hours.map(h => {
    const hobs = hourly_map[h];
    const hk = hobs.filter(o => o.choruses >= 1.0).length;
    return (hk / hobs.length * 100).toFixed(1);
  });

  if (chartsMap[chartId]) {
    chartsMap[chartId].destroy();
  }

  chartsMap[chartId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: '成功率(%)',
        data: data,
        borderColor: '#0b74de',
        backgroundColor: 'rgba(11, 116, 222, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#10b981',
        pointBorderColor: '#fff',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          min: 0,
          max: 100,
          ticks: { callback: v => v + '%' }
        }
      }
    }
  });
}

async function showStats(){
  try{
    if(!currentStationId) return;
    
    const target = document.getElementById('stationStats');
    const station = stationsData.find(s => s.id === currentStationId);
    if (!station) { 
      target.innerHTML = '<div class="card"><p style="color:var(--fail)">駅情報が見つかりません</p></div>'; 
      return; 
    }

    const obs_all = dataStore.getObservationsByStation(currentStationId);
    const total = obs_all.length;
    const k = obs_all.filter(o => o.choruses >= 1.0).length;
    const [ci_low, ci_high] = wilson_interval(k, total);

    let html = `<div class="card">
      <h2 style="margin-top:0">${escapeHtml(station.station_name)} <span style="font-size:14px;color:#10b981;margin-left:8px">🔄 リアルタイム同期中</span></h2>
      <p style="color:var(--muted);margin:0">全観測数: ${total} 件 | 成功: ${k} 件</p>
    </div>`;

    const platforms_map = {};
    for (const o of obs_all) {
      if (!platforms_map[o.platform]) {
        platforms_map[o.platform] = [];
      }
      platforms_map[o.platform].push(o);
    }

    if (Object.keys(platforms_map).length === 0) {
      html += '<div class="card"><p>まだ観測データがありません</p></div>';
    } else {
      for (const platNum of Object.keys(platforms_map).sort((a, b) => Number(a) - Number(b))) {
        const obs_plat = platforms_map[platNum];
        const n = obs_plat.length;
        const kk = obs_plat.filter(o => o.choruses >= 1.0).length;
        const ph = kk / n;
        const [lowp, highp] = wilson_interval(kk, n);
        const fillPercent = ph * 100;

        const melody = dataStore.getMelody(currentStationId, Number(platNum));
        const melodyName = melody ? melody.melody_name : '未設定';

        const hourly_map = {};
        for (const o of obs_plat) {
          if (o.reported_at) {
            const d = new Date(o.reported_at);
            const h = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0);
            const key = h.toISOString();
            if (!hourly_map[key]) hourly_map[key] = [];
            hourly_map[key].push(o);
          }
        }

        const latest = obs_plat.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);
        const chartId = `chart-${platNum}`;

        html += `<div class="platform-card">
          <div class="platform-header">
            <div>
              <div class="platform-num">番線 ${platNum}</div>
              <div class="melody-name">${escapeHtml(melodyName)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:12px;color:var(--muted)">観測: ${n} 件</div>
            </div>
          </div>

          <div class="stats-big">
            <div class="stat-box">
              <div class="stat-label">成功数</div>
              <div class="stat-value">${kk}</div>
            </div>
            <div class="stat-box">
              <div class="stat-label">成功率</div>
              <div class="stat-value" style="font-size:48px">${(ph*100).toFixed(1)}%</div>
            </div>
          </div>

          <div style="background:#f9fafb;padding:12px;border-radius:8px;margin:12px 0">
            <div style="font-size:12px;color:var(--muted);margin-bottom:6px">信頼区間 (95% CI)</div>
            <div class="probability-bar">
              <div class="probability-fill" style="width:${fillPercent}%">
                <span style="text-shadow:0 1px 3px rgba(0,0,0,0.3)">${(ph*100).toFixed(1)}%</span>
              </div>
            </div>
            <div style="font-size:12px;color:var(--muted);text-align:center">
              ${(lowp*100).toFixed(1)}% ～ ${(highp*100).toFixed(1)}%
            </div>
          </div>`;

        if (Object.keys(hourly_map).length > 0) {
          html += `<h4 style="margin:16px 0 8px;font-size:14px">⏰ 時間帯別 成功率</h4>
            <div class="chart-container">
              <canvas id="${chartId}"></canvas>
            </div>`;
        }

        html += `<button class="melody-btn" onclick="saveMelodyName(${platNum})">
          🎵 メロディー名を登録
        </button>`;

        if(latest.length > 0){
          html += `<button class="details-btn" onclick="openModal(${platNum}, ${JSON.stringify(latest).replace(/"/g, '&quot;')})">
            📋 詳細を見る（直近5件）
          </button>`;
        }

        html += '</div>';
      }
    }

    target.innerHTML = html;

    setTimeout(() => {
      for (const platNum of Object.keys(platforms_map)) {
        const obs_plat = platforms_map[platNum];
        const hourly_map = {};
        for (const o of obs_plat) {
          if (o.reported_at) {
            const d = new Date(o.reported_at);
            const h = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), 0, 0, 0);
            const key = h.toISOString();
            if (!hourly_map[key]) hourly_map[key] = [];
            hourly_map[key].push(o);
          }
        }
        if (Object.keys(hourly_map).length > 0) {
          renderHourlyChart(platNum, hourly_map);
        }
      }
    }, 0);

  }catch(err){
    log('showStats',err);
  }
}

window.exportData = async function() {
  try {
    const json = await dataStore.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `melody-observer-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('データをエクスポートしました');
  } catch(err) {
    log('exportData error:', err);
    showToast('エクスポートに失敗しました');
  }
}

window.importData = function() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      const success = await dataStore.importJSON(text);
      if (success) {
        showToast('データをインポートしました');
      } else {
        showToast('インポートに失敗しました');
      }
    } catch(err) {
      log('importData error:', err);
      showToast('インポートに失敗しました');
    }
  };
  input.click();
}

window.addEventListener('load', async ()=>{
  try {
    showToast('🔄 Firebase接続中...');
    await dataStore.init();
    showToast('✓ Firebase接続完了');
    
    await loadStationsFromCSV();
    
    const reportedAtInput = document.getElementById('reported_at');
    if(reportedAtInput) reportedAtInput.value = isoLocalDatetime(new Date());
    
    const form = document.getElementById('obsForm');
    if(form) form.addEventListener('submit', submitForm);
    
    const searchInput = document.getElementById('stationSearch');
    if(searchInput){
      searchInput.addEventListener('input', (e) => {
        renderStationList(e.target.value);
      });
    }

    // リアルタイム更新リスナー
    dataStore.on('observations_updated', async () => {
      if (currentStationId) {
        await showStats();
      }
    });

    dataStore.on('melodies_updated', async () => {
      if (currentStationId) {
        await showStats();
      }
    });

  } catch(err) {
    log('init error', err);
    showToast('初期化エラーが発生しました');
  }
});

window.addEventListener('click', (e)=>{
  const modal = document.getElementById('detailsModal');
  if(e.target === modal) closeModal();
});