(() => {
  'use strict';

  const KEY = 'wishmap.places.v1';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const CAT_LABEL = { spot: '景點', food: '美食' };

  const ICON_PATHS = {
    spot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    food: '<path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9M17 21V3c-2 2-3 4.500-3 8h3"/>',
    done: '<path d="m5 12 5 5 9-10"/>',
    draft: '<path d="M12 5v14M5 12h14"/>',
    nav: '<path d="m12 3 7 18-7-4-7 4z"/>',
    street: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    star: '<path d="m12 3 2.700 5.600 6.100.900-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.900z"/>',
    pin: '<path d="M12 21s7-6.200 7-11.500a7 7 0 0 0-14 0C5 14.800 12 21 12 21z"/><circle cx="12" cy="9.500" r="2.500"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
    map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>',
  };
  const ico = (name, size = 22) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name]}</svg>`;

  // ---------- 資料 ----------
  function newId() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  // allowEmptyName：新增中的草稿可以先沒有名字
  function normalize(p, allowEmptyName = false) {
    if (!p || typeof p !== 'object') return null;
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    const name = String(p.name ?? '').trim();
    if (!name && !allowEmptyName) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return {
      id: String(p.id || newId()),
      name,
      category: p.category === 'food' ? 'food' : 'spot',
      lat,
      lng,
      address: String(p.address ?? ''),
      country: String(p.country ?? ''),
      city: String(p.city ?? ''),
      note: String(p.note ?? ''),
      recommendedBy: String(p.recommendedBy ?? ''),
      myRating: Math.min(5, Math.max(0, Math.round(Number(p.myRating) || 0))),
      visited: Boolean(p.visited),
      createdAt: Number(p.createdAt) || Date.now(),
    };
  }

  function loadPlaces() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(raw) ? raw.map((p) => normalize(p)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  function savePlaces() {
    try {
      localStorage.setItem(KEY, JSON.stringify(places));
    } catch {
      toast('儲存失敗：手機的瀏覽器儲存空間不可用');
    }
  }

  let places = loadPlaces();
  let me = null;          // 目前位置 { lat, lng }
  let current = null;     // 開啟中的面板 { place, isNew, confirmDel }
  const filters = { cat: 'all', status: 'all', region: 'all' };

  // ---------- 工具 ----------
  function distanceKm(a, b) {
    const R = 6371;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function fmtDist(km) {
    if (km < 1) return `${Math.round(km * 1000)} 公尺`;
    if (km < 100) return `${km.toFixed(1)} 公里`;
    return `${Math.round(km).toLocaleString()} 公里`;
  }

  const coord = (p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const googleSearchUrl = (q) =>
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  const navUrl = (p) =>
    `https://www.google.com/maps/dir/?api=1&destination=${coord(p)}`;
  const streetUrl = (p) =>
    `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${coord(p)}`;
  const reviewUrl = (p) =>
    googleSearchUrl([p.name, p.city, p.country].filter(Boolean).join(' ').trim() || coord(p));

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
  }

  function visiblePlaces() {
    return places.filter((p) => {
      if (filters.cat !== 'all' && p.category !== filters.cat) return false;
      if (filters.status === 'todo' && p.visited) return false;
      if (filters.status === 'done' && !p.visited) return false;
      if (filters.region !== 'all') {
        const [country, city] = filters.region.split('|');
        if ((p.country || '未知地區') !== country) return false;
        if (city !== undefined && p.city !== city) return false;
      }
      return true;
    });
  }

  // ---------- 地圖 ----------
  const map = L.map('map', { zoomControl: false }).setView([23.7, 121], 7);
  map.attributionControl.setPosition('bottomleft').setPrefix(false);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  const markerLayer = L.layerGroup().addTo(map);
  let meMarker = null;
  let draftMarker = null;

  function pinIcon(kind) {
    return L.divIcon({
      className: '',
      html: `<div class="pin ${kind}">${ico(kind, 18)}</div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 43],
    });
  }

  const iconFor = (p) => pinIcon(p.visited ? 'done' : p.category);

  function renderMarkers() {
    markerLayer.clearLayers();
    for (const p of visiblePlaces()) {
      L.marker([p.lat, p.lng], { icon: iconFor(p), title: p.name })
        .on('click', () => openDetail(p.id))
        .addTo(markerLayer);
    }
  }

  function fitAll() {
    const list = visiblePlaces();
    if (!list.length) return;
    if (list.length === 1) {
      map.setView([list[0].lat, list[0].lng], 14);
    } else {
      map.fitBounds(L.latLngBounds(list.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
    }
  }

  function focusOn(p) {
    map.invalidateSize();
    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15), { animate: false });
    const sheet = $('#sheet');
    if (!sheet.hidden) map.panBy([0, sheet.offsetHeight / 2], { animate: false });
  }

  // 長按（電腦上是右鍵）手動新增
  map.on('contextmenu', (e) => {
    const place = normalize({ lat: e.latlng.lat, lng: e.latlng.lng }, true);
    startDraft(place);
    reverseGeocode(place);
  });

  // ---------- 定位 ----------
  let firstFix = true;
  function locate(fly) {
    if (!navigator.geolocation) {
      if (fly) toast('這個瀏覽器不支援定位');
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      if (!meMarker) {
        meMarker = L.marker([me.lat, me.lng], {
          icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
          interactive: false,
          zIndexOffset: -100,
        }).addTo(map);
      } else {
        meMarker.setLatLng([me.lat, me.lng]);
      }
      if (fly || (firstFix && !places.length && !current)) map.setView([me.lat, me.lng], fly ? 15 : 13);
      firstFix = false;
      renderList();
    }, () => {
      if (fly) toast('無法取得位置，請在手機設定中允許定位權限');
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  // ---------- 清單 ----------
  function renderRegionOptions() {
    const sel = $('#f-region');
    const tree = new Map();
    for (const p of places) {
      const country = p.country || '未知地區';
      if (!tree.has(country)) tree.set(country, new Set());
      if (p.city) tree.get(country).add(p.city);
    }
    let html = '<option value="all">全部地區</option>';
    for (const country of [...tree.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'))) {
      html += `<option value="${esc(country)}">${esc(country)}</option>`;
      for (const city of [...tree.get(country)].sort((a, b) => a.localeCompare(b, 'zh-Hant'))) {
        html += `<option value="${esc(`${country}|${city}`)}">　${esc(city)}</option>`;
      }
    }
    sel.innerHTML = html;
    sel.value = filters.region;
    if (sel.value !== filters.region) {
      filters.region = 'all';
      sel.value = 'all';
    }
  }

  function renderList() {
    const list = visiblePlaces().map((p) => ({ p, d: me ? distanceKm(me, p) : null }));
    list.sort((a, b) => (me ? a.d - b.d : b.p.createdAt - a.p.createdAt));
    $('#list-info').textContent = !places.length ? '' :
      `${list.length} 個地點・${me ? '離你最近的排在最上面' : '允許定位後會依距離排序'}`;
    if (!list.length) {
      $('#list').innerHTML = places.length
        ? `<div class="empty"><div class="empty-art">${ico('map', 44)}</div><b>沒有符合的地點</b>換個篩選條件試試</div>`
        : `<div class="empty"><div class="empty-art">${ico('pin', 44)}</div><b>清單還是空的</b>把想去的景點和美食記下來吧
            <br><button type="button" class="btn primary" data-go="add">新增第一個地點</button></div>`;
      return;
    }
    $('#list').innerHTML = list.map(({ p, d }) => {
      const kind = p.visited ? 'done' : p.category;
      const where = [p.city, p.country].filter(Boolean).join('・') || p.address || '手動新增';
      const stars = p.myRating ? ` <span class="stars-inline">${'★'.repeat(p.myRating)}</span>` : '';
      return `<button type="button" class="item" data-id="${esc(p.id)}">
        <span class="badge ${kind}">${ico(kind, 24)}</span>
        <span class="item-main">
          <span class="item-name ${p.visited ? 'done' : ''}">${esc(p.name)}</span>
          <span class="item-sub">${CAT_LABEL[p.category]}・${esc(where)}${stars}</span>
        </span>
        ${d === null ? '' : `<span class="item-dist">${fmtDist(d)}</span>`}
      </button>`;
    }).join('');
  }

  function renderStats() {
    const food = places.filter((p) => p.category === 'food').length;
    const done = places.filter((p) => p.visited).length;
    $('#stats').textContent =
      `目前共 ${places.length} 個地點（景點 ${places.length - food}、美食 ${food}，已去過 ${done}）`;
  }

  function refreshAll() {
    renderRegionOptions();
    renderMarkers();
    renderList();
    renderStats();
  }

  // ---------- 面板（新增與詳情共用） ----------
  function renderSheet() {
    const { place: p, isNew, confirmDel } = current;
    const dist = me ? `・距離你 ${fmtDist(distanceKm(me, p))}` : '';
    const star = (n) =>
      `<button type="button" data-act="rate" data-n="${n}" class="${n <= p.myRating ? 'on' : ''}" aria-label="${n} 顆星">★</button>`;
    $('#sheet').innerHTML = `
      <div class="grab"></div>
      <div class="sheet-head">
        <input type="text" id="s-name" value="${esc(p.name)}" placeholder="幫這個地點取名字" aria-label="名稱">
        <button type="button" class="close" data-act="close" aria-label="關閉">${ico('close', 18)}</button>
      </div>
      <p class="addr">${ico('pin', 14)}<span><span id="s-addr">${esc(p.address || `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)}</span>${dist}</span></p>
      <div class="actions">
        <a class="btn primary" target="_blank" rel="noopener" href="${navUrl(p)}">${ico('nav')}導航</a>
        <a class="btn" target="_blank" rel="noopener" href="${streetUrl(p)}">${ico('street')}看街景</a>
        <a class="btn" id="s-review" target="_blank" rel="noopener" href="${esc(reviewUrl(p))}">${ico('star')}評論星級</a>
      </div>
      <div class="seg">
        <button type="button" data-act="cat" data-v="spot" class="spot ${p.category === 'spot' ? 'on' : ''}">${ico('spot', 18)}景點</button>
        <button type="button" data-act="cat" data-v="food" class="food ${p.category === 'food' ? 'on' : ''}">${ico('food', 18)}美食</button>
      </div>
      <div class="seg">
        <button type="button" data-act="visited" class="visited ${p.visited ? 'on' : ''}">${ico('done', 18)}${p.visited ? '已去過' : '標記為已去過'}</button>
      </div>
      <div class="rate"><span>我的評分</span>${[1, 2, 3, 4, 5].map(star).join('')}</div>
      <label class="field">誰推薦的
        <input type="text" id="s-rec" value="${esc(p.recommendedBy)}" placeholder="例如：小美、IG 上看到">
      </label>
      <label class="field">備註
        <textarea id="s-note" placeholder="想吃什麼、營業時間、注意事項…">${esc(p.note)}</textarea>
      </label>
      <div class="row ${isNew ? 'sticky' : ''}">
        ${isNew
          ? '<button type="button" class="btn" data-act="close">取消</button><button type="button" class="btn primary" data-act="save">加入清單</button>'
          : `<button type="button" class="btn danger" data-act="del">${confirmDel ? '確定刪除？再按一次' : '刪除這個地點'}</button>`}
      </div>`;
  }

  function openSheet(place, isNew) {
    current = { place, isNew, confirmDel: false };
    renderSheet();
    $('#sheet').hidden = false;
    $('#sheet').scrollTop = 0;
    $('#map-hint').hidden = true;
    focusOn(place);
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    if (draftMarker) {
      draftMarker.remove();
      draftMarker = null;
    }
    current = null;
  }

  function openDetail(id) {
    const p = places.find((x) => x.id === id);
    if (!p) return;
    showView('map');
    if (draftMarker) {
      draftMarker.remove();
      draftMarker = null;
    }
    openSheet(p, false);
  }

  function startDraft(place) {
    showView('map');
    if (draftMarker) draftMarker.remove();
    draftMarker = L.marker([place.lat, place.lng], { icon: pinIcon('draft'), zIndexOffset: 1000 }).addTo(map);
    openSheet(place, true);
  }

  // 已存的地點改了就立刻存檔；新增中的地點等按「加入清單」才存
  function commit() {
    if (!current || current.isNew) return;
    savePlaces();
    refreshAll();
  }

  $('#sheet').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !current) return;
    const p = current.place;
    const act = btn.dataset.act;
    if (act === 'close') {
      closeSheet();
      return;
    }
    if (act === 'save') {
      p.name = p.name.trim();
      if (!p.name) {
        toast('請先幫這個地點取名字');
        $('#s-name').focus();
        return;
      }
      p.createdAt = Date.now();
      places.push(p);
      savePlaces();
      closeSheet();
      refreshAll();
      toast(`已加入清單：${p.name}`);
      return;
    }
    if (act === 'del') {
      if (!current.confirmDel) {
        current.confirmDel = true;
        renderSheet();
        $('#sheet').scrollTop = $('#sheet').scrollHeight;
        return;
      }
      places = places.filter((x) => x.id !== p.id);
      savePlaces();
      closeSheet();
      refreshAll();
      toast(`已刪除：${p.name}`);
      return;
    }
    if (act === 'cat') p.category = btn.dataset.v;
    if (act === 'visited') p.visited = !p.visited;
    if (act === 'rate') {
      const n = Number(btn.dataset.n);
      p.myRating = p.myRating === n ? 0 : n;
    }
    current.confirmDel = false;
    const top = $('#sheet').scrollTop;
    renderSheet();
    $('#sheet').scrollTop = top;
    commit();
  });

  $('#sheet').addEventListener('input', (e) => {
    if (!current) return;
    const p = current.place;
    if (e.target.id === 's-name') {
      // 已存的地點不允許存成空白名稱
      if (current.isNew || e.target.value.trim()) p.name = e.target.value;
      $('#s-review').href = reviewUrl(p);
    } else if (e.target.id === 's-rec') {
      p.recommendedBy = e.target.value;
    } else if (e.target.id === 's-note') {
      p.note = e.target.value;
    } else {
      return;
    }
    commit();
  });

  // ---------- 搜尋 ----------
  const TYPE_LABEL = {
    restaurant: '餐廳', cafe: '咖啡廳', fast_food: '速食', bar: '酒吧', pub: '酒吧', food_court: '美食街',
    ice_cream: '冰品', bakery: '麵包店', confectionery: '甜點', marketplace: '市場',
    attraction: '景點', museum: '博物館', viewpoint: '觀景點', theme_park: '主題樂園', zoo: '動物園',
    gallery: '美術館', artwork: '藝術品', hotel: '旅館', park: '公園', garden: '花園',
    place_of_worship: '寺廟／教堂', castle: '城堡', monument: '紀念碑', memorial: '紀念物', ruins: '遺跡',
    station: '車站', peak: '山峰', beach: '海灘', island: '島', city: '城市', town: '城鎮',
    village: '村落', suburb: '地區', mall: '購物中心', department_store: '百貨公司', tower: '塔',
  };
  const FOOD_TYPES = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court',
    'ice_cream', 'bakery', 'confectionery', 'biergarten', 'marketplace']);
  const cityOf = (a) =>
    a.city || a.town || a.village || a.municipality || a.county || a.state || a.province || '';

  function placeFromResult(r) {
    const a = r.address || {};
    return normalize({
      name: r.name || String(r.display_name || '').split(',')[0],
      lat: r.lat,
      lng: r.lon,
      address: r.display_name,
      country: a.country,
      city: cityOf(a),
      category: FOOD_TYPES.has(r.type) ? 'food' : 'spot',
    });
  }

  // 辨識貼上的座標或 Google Maps 網址。回傳 null 表示是一般的名稱搜尋
  function parsePasted(q) {
    const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
    // 純座標必須帶小數點，避免把「7 11」這類名稱誤認成座標
    const dec = '(-?\\d{1,3}\\.\\d+)';
    let m = q.match(new RegExp(`^\\(?\\s*${dec}\\s*[,，\\s]\\s*${dec}\\s*\\)?$`));
    if (m) return { lat: Number(m[1]), lng: Number(m[2]), name: '' };
    if (!/^https?:\/\//i.test(q)) return null;
    if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(q)) return { error: 'short' };
    m = q.match(new RegExp(`!3d${num}!4d${num}`)) ||
      q.match(new RegExp(`@${num},${num}`)) ||
      q.match(new RegExp(`[?&](?:q|query|ll|destination|viewpoint)=${num}(?:,|%2C)${num}`, 'i'));
    if (!m) return { error: 'nocoord' };
    let name = '';
    const nm = q.match(/\/place\/([^/@?]+)/);
    if (nm) {
      try {
        name = decodeURIComponent(nm[1].replace(/\+/g, ' '));
      } catch {
        name = '';
      }
    }
    return { lat: Number(m[1]), lng: Number(m[2]), name };
  }

  // ---------- Plus Code（Google Maps 每個地點都有，可直接換算成座標） ----------
  const OLC = '23456789CFGHJMPQRVWX';
  const OLC_RES = [20, 1, 0.05, 0.0025, 0.000125];

  // code：去掉 + 號的完整代碼（10 或 11 碼），回傳該格子的中心點
  function olcDecode(code) {
    let lat = -90;
    let lng = -180;
    for (let i = 0; i < 5; i++) {
      lat += OLC.indexOf(code[i * 2]) * OLC_RES[i];
      lng += OLC.indexOf(code[i * 2 + 1]) * OLC_RES[i];
    }
    let latRes = OLC_RES[4];
    let lngRes = OLC_RES[4];
    if (code.length > 10) {
      const d = OLC.indexOf(code[10]);
      latRes /= 5;
      lngRes /= 4;
      lat += Math.floor(d / 4) * latRes;
      lng += (d % 4) * lngRes;
    }
    return { lat: lat + latRes / 2, lng: lng + lngRes / 2 };
  }

  // 取得某個位置的完整代碼前 len 碼，用來補齊短代碼
  function olcPrefix(lat, lng, len) {
    let a = lat + 90;
    let b = lng + 180;
    let s = '';
    for (let i = 0; i < len / 2; i++) {
      const r = OLC_RES[i];
      const da = Math.min(19, Math.floor(a / r));
      const db = Math.min(19, Math.floor(b / r));
      s += OLC[da] + OLC[db];
      a -= da * r;
      b -= db * r;
    }
    return s;
  }

  // 短代碼（例如 2HM7+X4）要靠附近的參考位置才能還原
  function olcRecover(prefix, suffix, ref) {
    const pad = 8 - prefix.length;
    const pos = olcDecode(olcPrefix(ref.lat, ref.lng, pad) + prefix + suffix);
    const res = OLC_RES[pad / 2 - 1];
    if (ref.lat + res / 2 < pos.lat && pos.lat - res >= -90) pos.lat -= res;
    else if (ref.lat - res / 2 > pos.lat && pos.lat + res <= 90) pos.lat += res;
    if (ref.lng + res / 2 < pos.lng) pos.lng -= res;
    else if (ref.lng - res / 2 > pos.lng) pos.lng += res;
    return pos;
  }

  function parsePlusCode(q) {
    const m = q.match(/^([2-9CFGHJMPQRVWX]{2,8})\+([2-9CFGHJMPQRVWX]{2,3})(?:[\s,，]+(.+))?$/i);
    if (!m || m[1].length % 2) return null;
    return { prefix: m[1].toUpperCase(), suffix: m[2].toUpperCase(), locality: (m[3] || '').trim() };
  }

  async function nominatim(path) {
    // 免費搜尋服務規定每秒最多一次
    const wait = 1100 - (Date.now() - lastSearchAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastSearchAt = Date.now();
    const res = await fetch(`https://nominatim.openstreetmap.org/${path}&accept-language=zh-TW,zh,en`,
      { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  // 回傳候選位置 [{ pos, label }]，或回傳要顯示給使用者的錯誤訊息字串。
  // 同名地區（例如世界上有很多個 Mountain View）會得到多個候選，交給使用者選。
  async function locatePlusCode(plus) {
    if (plus.prefix.length === 8) return [{ pos: olcDecode(plus.prefix + plus.suffix), label: '' }];
    if (!plus.locality) {
      if (me) return [{ pos: olcRecover(plus.prefix, plus.suffix, me), label: '' }];
      return '這組 Plus Code 少了後面的地區名稱。請在 Google Maps 把整行一起複製，例如「2HM7+X4 大安區 台北市」。';
    }
    const hits = await nominatim(`search?format=jsonv2&limit=6&q=${encodeURIComponent(plus.locality)}`);
    if (!hits.length) return `找不到「${plus.locality}」這個地區，請確認 Plus Code 後面的地區名稱有完整貼上。`;
    const seen = new Set();
    const list = [];
    for (const h of hits) {
      const pos = olcRecover(plus.prefix, plus.suffix, { lat: Number(h.lat), lng: Number(h.lon) });
      const key = `${pos.lat.toFixed(4)},${pos.lng.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ pos, label: h.display_name });
    }
    return list;
  }

  let lastSearchAt = 0;
  let lastNameQuery = '';
  let results = [];
  $('#search-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim();
    if (!q) return;
    cancelSuggest();
    const btn = $('#search-btn');
    const status = $('#search-status');
    const extra = $('#search-extra');
    $('#search-results').innerHTML = '';
    extra.hidden = true;

    const plus = parsePlusCode(q);
    if (plus) {
      btn.disabled = true;
      status.textContent = '正在換算位置…';
      try {
        const found = await locatePlusCode(plus);
        if (typeof found === 'string') {
          status.textContent = found;
          return;
        }
        // 帶入剛才搜尋過的名稱，省得再打一次
        results = found.map((f) => ({
          place: normalize({ name: lastNameQuery, lat: f.pos.lat, lng: f.pos.lng }, true),
          label: f.label,
          fromCode: true,
        }));
        if (results.length === 1) {
          status.textContent = '';
          pickResult(results[0]);
          return;
        }
        status.textContent = `有 ${results.length} 個同名的地區，請選擇正確的那一個：`;
        $('#search-results').innerHTML = results.map((r, i) => `
          <button type="button" class="result" data-i="${i}">
            <span class="badge spot">${ico('pin', 24)}</span>
            <span class="result-main">
              <b>${esc(r.label.split(',')[0])}</b>
              <span class="muted small">${esc(r.label)}</span>
            </span>
            <span class="chev">${ico('chev', 18)}</span>
          </button>`).join('');
      } catch {
        status.textContent = '換算失敗，請確認網路連線後再試一次。';
      } finally {
        btn.disabled = false;
      }
      return;
    }

    const pasted = parsePasted(q);
    if (pasted) {
      if (pasted.error === 'short') {
        status.textContent = '這是 Google Maps 的短網址，裡面沒有位置資訊，APP 讀不出來。請改貼座標：在 Google Maps 長按那個地點，複製上方出現的兩個數字再貼到這裡。';
        return;
      }
      const place = pasted.error ? null : normalize(pasted, true);
      if (!place) {
        status.textContent = '這個網址或座標讀不出位置，請改貼座標（例如 25.0339, 121.5645）。';
        return;
      }
      status.textContent = '';
      startDraft(place);
      reverseGeocode(place);
      return;
    }

    btn.disabled = true;
    status.textContent = '搜尋中…';
    lastNameQuery = q;
    try {
      // 免費搜尋服務規定每秒最多一次
      const wait = 1100 - (Date.now() - lastSearchAt);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastSearchAt = Date.now();
      const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=8' +
        `&accept-language=zh-TW,zh,en&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      results = data.map((r) => ({ place: placeFromResult(r), type: r.type })).filter((r) => r.place);
      if (!results.length) {
        status.textContent = '找不到符合的地點。可以加上城市名稱再試，或用下面的方式新增。';
      } else {
        status.textContent = `找到 ${results.length} 個結果，請選擇你要的那一個：`;
        showPlaceResults();
      }
    } catch {
      status.textContent = '搜尋失敗，請確認網路連線後再試一次。';
    } finally {
      btn.disabled = false;
      $('#btn-google').href = googleSearchUrl(q);
      extra.hidden = false;
    }
  });

  $('#search-results').addEventListener('click', (e) => {
    const btn = e.target.closest('.result');
    if (!btn) return;
    const r = results[Number(btn.dataset.i)];
    if (r) pickResult(r);
  });

  function showPlaceResults() {
    $('#search-results').innerHTML = results.map((r, i) => `
      <button type="button" class="result" data-i="${i}">
        <span class="badge ${r.place.category}">${ico(r.place.category, 24)}</span>
        <span class="result-main">
          <b>${esc(r.place.name)}${TYPE_LABEL[r.type] ? `<span class="tag">${TYPE_LABEL[r.type]}</span>` : ''}</b>
          <span class="muted small">${esc(r.place.address)}</span>
        </span>
        <span class="chev">${ico('chev', 18)}</span>
      </button>`).join('');
  }

  // ---------- 邊打邊出現的建議 ----------
  let suggestTimer = 0;
  let suggestCtl = null;

  function cancelSuggest() {
    clearTimeout(suggestTimer);
    if (suggestCtl) suggestCtl.abort();
    suggestCtl = null;
  }

  function placeFromPhoton(f) {
    const p = f.properties || {};
    const c = (f.geometry && f.geometry.coordinates) || [];
    const parts = [p.name, [p.street, p.housenumber].filter(Boolean).join(' '),
      p.district, p.city, p.county, p.state, p.country].filter(Boolean);
    return normalize({
      name: p.name,
      lat: c[1],
      lng: c[0],
      address: [...new Set(parts)].join(', '),
      country: p.country,
      city: p.city || p.county || p.state,
      category: FOOD_TYPES.has(p.osm_value) ? 'food' : 'spot',
    });
  }

  async function suggest(q) {
    const ctl = new AbortController();
    suggestCtl = ctl;
    // 以地圖目前所在的區域（約 10 公里精度）優先排序，附近的結果排前面
    const c = map.getCenter();
    try {
      const res = await fetch('https://photon.komoot.io/api/?limit=20' +
        `&lat=${c.lat.toFixed(1)}&lon=${c.lng.toFixed(1)}&q=${encodeURIComponent(q)}`, { signal: ctl.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (ctl.signal.aborted || $('#search-input').value.trim() !== q) return;
      const seen = new Set();
      const list = [];
      for (const f of data.features || []) {
        const p = f.properties || {};
        // 道路、站牌這類不是想去的地點，略過
        if (p.osm_key === 'highway' || p.osm_value === 'stop' || p.osm_value === 'platform') continue;
        const place = placeFromPhoton(f);
        if (!place) continue;
        const key = `${place.name}|${place.city}`;
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ place, type: p.osm_value });
        if (list.length === 8) break;
      }
      if (!list.length) return;
      results = list;
      $('#search-status').textContent = '建議的地點（沒有你要的就按「搜尋」找更多）：';
      $('#search-extra').hidden = true;
      showPlaceResults();
    } catch {
      // 建議只是輔助，失敗就不顯示，使用者仍可按「搜尋」
    }
  }

  function onSearchTyping(e) {
    // 注音／拼音還在選字時先不查，等選完字再查
    if (e.isComposing) return;
    cancelSuggest();
    const q = $('#search-input').value.trim();
    // 空白、座標、網址、Plus Code 不需要建議，並清掉上一次的建議
    if (!q || parsePlusCode(q) || parsePasted(q) || /^[\d\s.,+-]+$/.test(q)) {
      $('#search-results').innerHTML = '';
      $('#search-status').textContent = '';
      $('#search-extra').hidden = true;
      return;
    }
    suggestTimer = setTimeout(() => suggest(q), 350);
  }
  $('#search-input').addEventListener('input', onSearchTyping);
  $('#search-input').addEventListener('compositionend', onSearchTyping);

  function pickResult(r) {
    const place = { ...r.place, id: newId() };
    startDraft(place);
    if (r.fromCode) {
      // Plus Code 只有位置，地址和國家城市要另外查
      lastNameQuery = '';
      $('#search-input').value = '';
      reverseGeocode(place);
    }
  }

  $('#btn-manual').addEventListener('click', () => {
    showView('map');
    toast('把地圖移到那個位置，然後長按想新增的點');
  });

  async function reverseGeocode(place) {
    try {
      const url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18' +
        `&accept-language=zh-TW,zh,en&lat=${place.lat}&lon=${place.lng}`;
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const r = await res.json();
      const a = r.address || {};
      place.address = r.display_name || '';
      place.country = a.country || '';
      place.city = cityOf(a);
      if (current && current.place === place) {
        if (place.address) $('#s-addr').textContent = place.address;
        $('#s-review').href = reviewUrl(place);
        commit();
      }
    } catch {
      // 查不到地址不影響新增，保留座標即可
    }
  }

  // ---------- 分頁 ----------
  function showView(name) {
    if (name !== 'map' && current) closeSheet();
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('#filters').classList.toggle('hidden', name === 'add' || name === 'settings');
    if (name === 'map') map.invalidateSize();
    if (name === 'list') {
      renderList();
      locate(false);
    }
    if (name === 'settings') renderStats();
  }

  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) showView(btn.dataset.view);
  });

  $('#list').addEventListener('click', (e) => {
    if (e.target.closest('[data-go="add"]')) {
      showView('add');
      return;
    }
    const btn = e.target.closest('.item');
    if (btn) openDetail(btn.dataset.id);
  });

  $('#btn-locate').addEventListener('click', () => locate(true));

  for (const [id, key] of [['#f-cat', 'cat'], ['#f-status', 'status'], ['#f-region', 'region']]) {
    $(id).addEventListener('change', (e) => {
      filters[key] = e.target.value;
      if (current) closeSheet();
      renderMarkers();
      renderList();
      fitAll();
    });
  }

  // ---------- 備份 ----------
  $('#btn-export').addEventListener('click', () => {
    if (!places.length) {
      toast('目前沒有資料可以匯出');
      return;
    }
    const data = { app: 'wishmap', version: 1, exportedAt: new Date().toISOString(), places };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    a.href = URL.createObjectURL(blob);
    a.download = `待去地圖備份-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`已匯出 ${places.length} 個地點`);
  });

  function importPlaces(raw) {
    const incoming = Array.isArray(raw) ? raw : raw && raw.places;
    if (!Array.isArray(incoming)) throw new Error('format');
    const known = new Set(places.map((p) => p.id));
    let added = 0;
    let skipped = 0;
    for (const item of incoming) {
      const p = normalize(item);
      if (!p || known.has(p.id)) {
        skipped += 1;
        continue;
      }
      known.add(p.id);
      places.push(p);
      added += 1;
    }
    savePlaces();
    refreshAll();
    fitAll();
    return { added, skipped };
  }

  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { added, skipped } = importPlaces(JSON.parse(await file.text()));
      toast(`已匯入 ${added} 個地點${skipped ? `，略過 ${skipped} 個重複或無效的項目` : ''}`);
    } catch {
      toast('這不是有效的備份檔');
    }
  });

  // ---------- 啟動 ----------
  refreshAll();
  fitAll();
  locate(false);
  setTimeout(() => { $('#map-hint').hidden = true; }, 6000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
