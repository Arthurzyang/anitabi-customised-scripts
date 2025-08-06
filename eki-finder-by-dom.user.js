// ==UserScript==
// @name         Anitabi Eki/Bus Finder (By DOM)
// @namespace    https://anitabi.cn/
// @version      3.2
// @description  在 Anitabi 地标卡片插入两个按钮：① 8 km 内最近的 3 个电车站 ② 8 km 内最近的 3 个公交站。
// @match        https://anitabi.cn/map*
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {

  console.log('[Eki/Bus Finder] userscript loaded');

  'use strict';

  /* ===================== Haversine ===================== */
  const haversine = (lat1, lon1, lat2, lon2) => {

    const R = 6371000;
    const rad = d => d * Math.PI / 180;

    const dφ = rad(lat2 - lat1);
    const dλ = rad(lon2 - lon1);
    const a = Math.sin(dφ / 2) ** 2 +
               Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dλ / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  /* ===================== 坐标解析 ===================== */

  /* ——— 通过弹窗 DOM 提取 ll= / cbll= ——— */
  const coordFromDom = root => {

    const a = root.querySelector(
      'a[href*="maps"][href*="ll="], a[href*="maps"][href*="cbll="]'
    );

    if (!a) {
      console.warn('[Eki/Bus Finder] 没有找到 Google Maps 链接 (ll/cbll)');
      return null;
    }

    const m = /[?&](?:ll|cbll)=([-\.\d]+),([-\.\d]+)/.exec(a.href);
    if (!m) {
      console.warn('[Eki/Bus Finder] Google 链接存在，但未匹配 ll/cbll：', a.href);
      return null;
    }

    console.log('[Eki/Bus Finder] 通过 DOM 解析坐标成功：', m[1], m[2]);

    return { lat: +m[1], lon: +m[2] }; // 参数顺序为 lat,lon
  };

  /* ——— 若 DOM 失败则调用官方 API ——— */
  const coordFromApi = async () => {

    const p = new URLSearchParams(location.search);
    const bangumiId = p.get('bangumiId');
    const pid = p.get('pid');

    if (!bangumiId || !pid) {
      console.warn('[Eki/Bus Finder] URL 缺少 bangumiId 或 pid；无法调用 API');
      return null;
    }

    const apiUrl = `https://api.anitabi.cn/bangumi/${bangumiId}/points/detail?haveImage=false`;
    console.log('[Eki/Bus Finder] 调用 API 获取坐标：', apiUrl);

    try {

      const arr = await (await fetch(apiUrl)).json();
      const pt = arr.find(x => x.id === pid);

      if (pt && Array.isArray(pt.geo)) {
        const [lat, lon] = pt.geo;
        console.log('[Eki/Bus Finder] API 返回坐标：', lat, lon);
        return { lat, lon };
      }

      console.warn('[Eki/Bus Finder] API 中未找到匹配 pid 的地标');

    } catch (err) {

      console.error('[Eki/Bus Finder] API 调用异常', err);
    }

    return null;
  };

  /* ——— 统一坐标解析入口 ——— */
  const resolveCoord = async root => coordFromDom(root) || await coordFromApi();

  /* ===================== Overpass 查询 ===================== */
  function queryTopN(lat, lon, filterQL, N, cb) {

    const ql = `
      [out:json][timeout:25];
      (
        ${filterQL}(around:8000,${lat},${lon});
      );
      out body;`;

    console.log('[Eki/Bus Finder] Overpass 查询体：\n', ql);

    GM_xmlhttpRequest({

      method : 'POST',
      url    : 'https://overpass-api.de/api/interpreter',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data   : 'data=' + encodeURIComponent(ql),

      onload: r => {

        if (r.status !== 200) {
          console.error('[Eki/Bus Finder] Overpass 返回状态非 200：', r.status, r.statusText);
          cb(false);
          return;
        }

        try {
          const js = JSON.parse(r.responseText);

          if (!js.elements.length) {
            console.info('[Eki/Bus Finder] 8 km 内无匹配节点');
            cb(null);
            return;
          }

          const list = js.elements
            .map(n => ({
              name : n.tags?.name || '(未知站点)',
              dist : haversine(lat, lon, n.lat, n.lon)
            }))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, N);

          console.log('[Eki/Bus Finder] Overpass 结果：', list);
          cb(list);
        } catch (e) {
          console.error('[Eki/Bus Finder] JSON 解析失败', e);
          cb(false);
        }
      },

      onerror: e => {
        console.error('[Eki/Bus Finder] Overpass 请求失败', e);
        cb(false);
      }
    });
  }

  /* ===================== UI Helpers ===================== */
  const fmt = arr => arr
    .map((o, i) => `${i + 1}. ${o.name} ${(o.dist / 1000).toFixed(2)} km`)
    .join(' | ');

  const mkBtn = (label, handler) => {

    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'eki-btn';
    b.style.cssText = [
      'display:inline-block',
      'margin:6px 6px 0 0',
      'padding:4px 8px',
      'font-size:12px',
      'color:#fff',
      'background:#ff7b00',
      'border:none',
      'border-radius:4px',
      'cursor:pointer'
    ].join(';');

    b.addEventListener('click', handler);

    return b;
  };

  /* ——— 在每个弹窗插入按钮面板 ——— */
  function attach(card) {
    if (card.querySelector('.eki-btn')) return;

    const out = document.createElement('div');
    out.style.cssText = 'font-size:12px;margin:4px 0;white-space:pre-wrap;';

    const railBtn = mkBtn('8 km 内电车站', async () => {
      railBtn.disabled = busBtn.disabled = true;
      out.textContent = '⌛ 获取坐标…';

      const pos = await resolveCoord(card);
      if (!pos) {
        out.textContent = '❓ 坐标缺失（详见控制台）';
        railBtn.disabled = busBtn.disabled = false;
        return;
      }

      out.textContent = '⌛ 查询中…';
      queryTopN(
        pos.lat,
        pos.lon,
        'node["railway"~"^(station|halt|tram_stop)$"]',
        3,
        res => {
          railBtn.disabled = busBtn.disabled = false;

          if (res === false) { out.textContent = '🚫 查询失败（详见控制台）'; return; }
          if (res === null) { out.textContent = 'ℹ 8 km 内无电车站'; return; }
          out.textContent = '🚉 ' + fmt(res);
        }
      );
    });

    const busBtn = mkBtn('8 km 内公交站', async () => {

      railBtn.disabled = busBtn.disabled = true;
      out.textContent = '⌛ 获取坐标…';

      const pos = await resolveCoord(card);
      if (!pos) {
        out.textContent = '❓ 坐标缺失（详见控制台）';
        railBtn.disabled = busBtn.disabled = false;
        return;
      }

      out.textContent = '⌛ 查询中…';
      queryTopN(
        pos.lat,
        pos.lon,
        'node["highway"="bus_stop"]',
        3,
        res => {
          railBtn.disabled = busBtn.disabled = false;

          if (res === false) { out.textContent = '🚫 查询失败（详见控制台）'; return; }
          if (res === null) { out.textContent = 'ℹ 8 km 内无公交站'; return; }
          out.textContent = '🚌 ' + fmt(res);
        }
      );
    });

    card.append(railBtn, busBtn, out);
  }

  /* ===================== MutationObserver ===================== */
  const SELS = [
    '.poi-card',
    '.leaflet-popup-content',
    '.mapboxgl-popup-content'
  ];

  const obs = new MutationObserver(mutations => {
    mutations.forEach(m => m.addedNodes.forEach(node => {

      if (!(node instanceof HTMLElement)) return;

      SELS.forEach(s => node.matches(s) && attach(node));
      SELS.forEach(s => node.querySelectorAll(s).forEach(attach));
    }));
  });

  obs.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('load', () => {
    SELS.forEach(sel => document.querySelectorAll(sel).forEach(attach));
  });
})();
