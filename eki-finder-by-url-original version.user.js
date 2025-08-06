// ==UserScript==
// @name         Anitabi Eki Finder (By URL)
// @namespace    https://anitabi.cn/
// @version      1.2
// @description  在 Anitabi 地标卡片上插入「最近的电车站」按钮，点击后在卡片内显示最近铁路/电车站及距离
// @match        https://anitabi.cn/map*
// @grant        GM_xmlhttpRequest
// @run-at       document-end
// ==/UserScript==

(function () {

  /* =====================================================================
   * Script entry
   * ---------------------------------------------------------------------
   *  1. 解析当前 URL 里的经纬度
   *  2. 向 Overpass API 查询半径 4 km 内最近 railway 相关节点
   *  3. 把结果直接显示在地标弹窗（卡片）里
   *  4. 使用 MutationObserver 监听弹窗的增删，确保按钮始终存在
   * ===================================================================*/

  console.log('[Anitabi Eki Finder] userscript loaded!');

  'use strict';

  /* ===== utils ========================================================= */
  
  // 匹配 URL 中的 `c=lon,lat` 参数。
  const RE_C = /[?&#]c=([-.\d]+),([-.\d]+)/;

  //从任意 URL 字符串中提取经纬度。
  const getCoord = url => {
    const m = RE_C.exec(url);
    return m ? { lon: +m[1], lat: +m[2] } : null;
  };

  //Haversine 公式计算两点间球面距离（单位：米）。
  const haversine = (lat1, lon1, lat2, lon2) => {

    const R = 6_371_000;               // 地球平均半径 (m)
    const toRad = x => x * Math.PI / 180;

    const dφ = toRad(lat2 - lat1);
    const dλ = toRad(lon2 - lon1);

    const a = Math.sin(dφ / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dλ / 2) ** 2;

    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };


  /* ===== 查询 Overpass ================================================ */

  /**
   * 查询半径 4 km 内最近的铁路/电车站点。
   * @param {number} lat   当前纬度
   * @param {number} lon   当前经度
   * @param {(info: {name:string, dist:number}|null|false)=>void} cb  回调
   *        - info 对象   成功：最近站点数据
   *        - null        没找到任何站点
   *        - false       网络/解析失败
   */
  function queryNearestStation(lat, lon, cb) {

    // Overpass QL 查询模板：railway=station / halt / tram_stop
    const q = `
      [out:json][timeout:25];
      (
        node["railway"="station"](around:4000,${lat},${lon});
        node["railway"="halt"](around:4000,${lat},${lon});
        node["railway"="tram_stop"](around:4000,${lat},${lon});
      );
      out body;`;

    // 通过 Tampermonkey 的 GM_xmlhttpRequest 绕过 CORS 限制
    GM_xmlhttpRequest({

      method: 'POST',
      url: 'https://overpass-api.de/api/interpreter',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'data=' + encodeURIComponent(q),

      //响应
      onload: res => {

        try {

          const json = JSON.parse(res.responseText);

          if (!json.elements.length) {
            cb(null);      // 未找到站点
            return;
          }

          // 取距离最近的一条
          let best = null;
          json.elements.forEach(n => {

            const d = haversine(lat, lon, n.lat, n.lon);

            if (!best || d < best.dist) {
              best = {
                name: n.tags?.name || '(无名站)',
                dist: d
              };
            }
          });

          cb(best);

        } catch (err) {

          console.error('[EkiFinder] JSON parse error', err);
          cb(false);
        }
      },

      //连接不上、超时等）
      onerror: () => cb(false)
    });
  }

  /* ===== DOM 操作 ===================================================== */

  /**
   * 弹窗容器的候选选择器。根据实际站点 DOM，如有变动可在此处增补。
   */
  const SELECTORS = [
    '.poi-card',                // Anitabi 自定义卡片
    '.leaflet-popup-content',   // Leaflet 默认 popup
    '.mapboxgl-popup-content'   // MapboxGL popup
  ];

  /**
   * 创建按钮 + 结果显示元素，并绑定点击逻辑。
   * @returns {HTMLDivElement}
   */
  function makeBtn() {

    /* -- 按钮本体 ------------------------------------------------------ */
    const btn = document.createElement('button');
    btn.textContent = '最近的电车站点';
    btn.className = 'railway-btn';
    btn.style.cssText = [
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

    /* -- 结果文本 ------------------------------------------------------ */
    const resultEl = document.createElement('span');
    resultEl.className = 'railway-result';
    resultEl.style.cssText = 'font-size:12px;margin-left:4px;';

    /* -- 点击事件 ------------------------------------------------------ */
    btn.addEventListener('click', () => {

      const pos = getCoord(location.href);
      
      //URL读不到坐标的情况
      if (!pos) {
        resultEl.textContent = '❓ 坐标缺失';
        return;
      }

      //查询中
      btn.disabled = true;
      resultEl.textContent = '⌛ 查询中…';

      queryNearestStation(pos.lat, pos.lon, info => {

        btn.disabled = false;

        //查询失败的情况
        if (info === false) {
          resultEl.textContent = '🚫 查询失败';
          return;
        }

        //4公里内无站点的情况
        if (info === null) {
          resultEl.textContent = 'ℹ 半径4公里内无站点';
          return;
        }

        // 成功：展示站名 + 距离（保留两位小数，单位 km）
        resultEl.textContent = `✅ ${info.name}（${(info.dist / 1000).toFixed(2)} km）`;
      });
    });

    /* -- 将按钮 + 文本包装在 div 里，方便一次性插入 ---------------- */
    const wrap = document.createElement('div');
    wrap.append(btn, resultEl);

    return wrap;
  }

  /* ===== 监控弹窗新增，并注入按钮 =================================== */

  /**
   * 向指定弹窗根元素注入按钮（若尚未注入）。
   */
  const inject = root => {
    if (root.querySelector('.railway-btn')) return; // 已有按钮
    root.appendChild(makeBtn());
  };

  /**
   * MutationObserver：监听页面 DOM 变化，捕捉新弹窗。
   */
  const obs = new MutationObserver(records => {

    records.forEach(rec => {
      rec.addedNodes.forEach(node => {

        if (!(node instanceof HTMLElement)) return;

        // 新增节点本身是否是弹窗
        SELECTORS.forEach(sel => node.matches(sel) && inject(node));
        // 或者新增节点内部是否包含弹窗
        SELECTORS.forEach(sel => node.querySelectorAll(sel).forEach(inject));
      });
    });
  });

  obs.observe(document.body, { childList: true, subtree: true });

  /* ===== 首次加载时，若弹窗已存在也需注入 =========================== */
  window.addEventListener('load', () => {
    SELECTORS.forEach(sel => {
      document.querySelectorAll(sel).forEach(inject);
    });
  });

})();
