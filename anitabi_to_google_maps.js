// ==UserScript==
// @name         Anitabi 当前作品地标导出 Google My Maps
// @namespace    https://anitabi.cn/
// @version      0.1.0
// @description  在 Anitabi 地图页一键导出当前作品地标为 CSV / KML，方便导入 Google My Maps。GPT老师速成
// @match        https://www.anitabi.cn/map*
// @match        https://anitabi.cn/map*
// @grant        GM_xmlhttpRequest
// @connect      api.anitabi.cn
// ==/UserScript==

(function () {
  "use strict";

  const API_BASE = "https://api.anitabi.cn";

  function getBangumiIdsFromUrl() {
    const params = new URLSearchParams(location.search);

    // 支持：
    // ?bangumiId=262897
    // ?bangumiId=90880 262897
    // ?bangumiId=90880,262897
    // ?bangumiId=90880&bangumiId=262897
    const all = params.getAll("bangumiId").join(" ");

    return [...new Set(
      all
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean)
    )];
  }

  function gmGetJson(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        headers: {
          Accept: "application/json",
        },
        timeout: 20000,
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`请求失败：${res.status} ${res.statusText || ""}`));
            return;
          }

          try {
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(new Error("JSON 解析失败：" + e.message));
          }
        },
        onerror: () => reject(new Error("网络请求失败")),
        ontimeout: () => reject(new Error("网络请求超时")),
      });
    });
  }

  function csvEscape(value) {
    const s = value === undefined || value === null ? "" : String(value);
    return `"${s.replace(/"/g, '""')}"`;
  }

  function xmlEscape(value) {
    const s = value === undefined || value === null ? "" : String(value);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function htmlEscape(value) {
    const s = value === undefined || value === null ? "" : String(value);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function cdataSafe(value) {
    return String(value).replace(/]]>/g, "]]]]><![CDATA[>");
  }

  function cleanFileName(value) {
    return String(value || "anitabi")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 120);
  }

  function formatSeconds(sec) {
    if (sec === undefined || sec === null || sec === "") return "";
    const n = Number(sec);
    if (!Number.isFinite(n)) return String(sec);

    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = Math.floor(n % 60);

    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function downloadText(filename, text, mimeType) {
    const blob = new Blob([text], {
      type: `${mimeType};charset=utf-8`,
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
  }

  async function fetchBangumiWithPoints(bangumiId) {
    const liteUrl = `${API_BASE}/bangumi/${encodeURIComponent(bangumiId)}/lite`;
    const pointsUrl = `${API_BASE}/bangumi/${encodeURIComponent(bangumiId)}/points/detail`;

    const [lite, pointsRaw] = await Promise.all([
      gmGetJson(liteUrl),
      gmGetJson(pointsUrl),
    ]);

    const points = Array.isArray(pointsRaw) ? pointsRaw : [];

    return {
      bangumiId,
      lite,
      points,
    };
  }

  function makeRows(items) {
    const rows = [];

    for (const item of items) {
      const bangumiId = item.bangumiId;
      const lite = item.lite || {};
      const subjectName = lite.cn || lite.title || `Bangumi ${bangumiId}`;

      for (const p of item.points || []) {
        if (!Array.isArray(p.geo) || p.geo.length < 2) continue;

        const lat = Number(p.geo[0]);
        const lng = Number(p.geo[1]);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const pointName = p.cn || p.name || p.id || "未命名地标";
        const anitabiPointUrl = `https://anitabi.cn/map?bangumiId=${encodeURIComponent(bangumiId)}&pointId=${encodeURIComponent(p.id || "")}`;
        const googleSearchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;

        rows.push({
          subjectId: bangumiId,
          subjectName,
          pointId: p.id || "",
          name: pointName,
          latitude: lat,
          longitude: lng,
          episode: p.ep ?? "",
          timeSeconds: p.s ?? "",
          timeText: formatSeconds(p.s),
          image: p.image || "",
          origin: p.origin || "",
          originURL: p.originURL || "",
          anitabiURL: anitabiPointUrl,
          googleMapsURL: googleSearchUrl,
        });
      }
    }

    return rows;
  }

  function buildCsv(rows) {
    const headers = [
      "Name",
      "Latitude",
      "Longitude",
      "Description",
      "Bangumi",
      "BangumiID",
      "PointID",
      "Episode",
      "TimeSeconds",
      "TimeText",
      "Image",
      "Origin",
      "OriginURL",
      "AnitabiURL",
      "GoogleMapsURL",
    ];

    const lines = [headers.map(csvEscape).join(",")];

    for (const r of rows) {
      const desc = [
        `作品：${r.subjectName}`,
        r.episode !== "" ? `集数：${r.episode}` : "",
        r.timeText ? `时间：${r.timeText}` : "",
        r.origin ? `来源：${r.origin}` : "",
        r.originURL ? `来源链接：${r.originURL}` : "",
        `Anitabi：${r.anitabiURL}`,
      ].filter(Boolean).join(" | ");

      const line = [
        r.name,
        r.latitude,
        r.longitude,
        desc,
        r.subjectName,
        r.subjectId,
        r.pointId,
        r.episode,
        r.timeSeconds,
        r.timeText,
        r.image,
        r.origin,
        r.originURL,
        r.anitabiURL,
        r.googleMapsURL,
      ].map(csvEscape).join(",");

      lines.push(line);
    }

    // 加 BOM，避免 Excel 打开中文乱码
    return "\uFEFF" + lines.join("\r\n");
  }

  function buildKml(rows, documentName) {
    const placemarks = rows.map(r => {
      // KML 坐标顺序是 经度,纬度,高度
      // Anitabi geo 是 纬度,经度
      const descHtml = `
        <div>
          <p><b>作品：</b>${htmlEscape(r.subjectName)}</p>
          ${r.episode !== "" ? `<p><b>集数：</b>${htmlEscape(r.episode)}</p>` : ""}
          ${r.timeText ? `<p><b>时间：</b>${htmlEscape(r.timeText)}</p>` : ""}
          ${r.image ? `<p><img src="${htmlEscape(r.image)}" style="max-width:240px;"></p>` : ""}
          ${r.origin ? `<p><b>来源：</b>${htmlEscape(r.origin)}</p>` : ""}
          ${r.originURL ? `<p><a href="${htmlEscape(r.originURL)}">来源链接</a></p>` : ""}
          <p><a href="${htmlEscape(r.anitabiURL)}">Anitabi 地标</a></p>
          <p><a href="${htmlEscape(r.googleMapsURL)}">在 Google Maps 中打开</a></p>
        </div>
      `;

      return `
    <Placemark>
      <name>${xmlEscape(r.name)}</name>
      <description><![CDATA[${cdataSafe(descHtml)}]]></description>
      <ExtendedData>
        <Data name="Bangumi"><value>${xmlEscape(r.subjectName)}</value></Data>
        <Data name="BangumiID"><value>${xmlEscape(r.subjectId)}</value></Data>
        <Data name="PointID"><value>${xmlEscape(r.pointId)}</value></Data>
        <Data name="Episode"><value>${xmlEscape(r.episode)}</value></Data>
        <Data name="TimeSeconds"><value>${xmlEscape(r.timeSeconds)}</value></Data>
        <Data name="Origin"><value>${xmlEscape(r.origin)}</value></Data>
      </ExtendedData>
      <Point>
        <coordinates>${r.longitude},${r.latitude},0</coordinates>
      </Point>
    </Placemark>`;
    }).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${xmlEscape(documentName)}</name>
${placemarks}
  </Document>
</kml>`;
  }

  async function exportCurrent(format) {
    const ids = getBangumiIdsFromUrl();

    if (ids.length === 0) {
      alert("当前 URL 里没有 bangumiId，例如：https://www.anitabi.cn/map?bangumiId=262897");
      return;
    }

    setStatus(`正在获取 ${ids.length} 个作品的地标……`);

    try {
      const items = [];

      for (const id of ids) {
        setStatus(`正在获取作品 ${id} 的完整地标……`);
        items.push(await fetchBangumiWithPoints(id));
      }

      const rows = makeRows(items);

      if (rows.length === 0) {
        alert("没有找到带坐标的地标。");
        setStatus("没有找到可导出的地标");
        return;
      }

      const firstName = items[0]?.lite?.cn || items[0]?.lite?.title || ids[0];
      const fileBase = cleanFileName(
        ids.length === 1
          ? `anitabi_${ids[0]}_${firstName}_${rows.length}points`
          : `anitabi_multi_${ids.join("_")}_${rows.length}points`
      );

      const documentName = ids.length === 1
        ? `Anitabi - ${firstName}`
        : `Anitabi - ${ids.length} works`;

      if (format === "csv") {
        const csv = buildCsv(rows);
        downloadText(`${fileBase}.csv`, csv, "text/csv");
        setStatus(`已导出 CSV：${rows.length} 个地标`);
      } else if (format === "kml") {
        const kml = buildKml(rows, documentName);
        downloadText(`${fileBase}.kml`, kml, "application/vnd.google-earth.kml+xml");
        setStatus(`已导出 KML：${rows.length} 个地标`);
      }
    } catch (e) {
      console.error(e);
      alert("导出失败：" + e.message);
      setStatus("导出失败，详情看 Console");
    }
  }

  let statusEl = null;

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function createPanel() {
    if (document.getElementById("anitabi-google-export-panel")) return;

    const panel = document.createElement("div");
    panel.id = "anitabi-google-export-panel";

    panel.innerHTML = `
      <div class="age-title">Anitabi 导出</div>
      <button class="age-btn" data-format="csv">导出 Google CSV</button>
      <button class="age-btn" data-format="kml">导出 Google KML</button>
      <div class="age-status">等待导出</div>
    `;

    const style = document.createElement("style");
    style.textContent = `
      #anitabi-google-export-panel {
        position: fixed;
        top: 84px;
        right: 16px;
        z-index: 999999;
        width: 190px;
        padding: 10px;
        border-radius: 10px;
        background: rgba(255, 255, 255, 0.95);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        font-size: 13px;
        color: #222;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      #anitabi-google-export-panel .age-title {
        font-weight: 700;
        margin-bottom: 8px;
      }

      #anitabi-google-export-panel .age-btn {
        width: 100%;
        margin: 4px 0;
        padding: 7px 8px;
        border: 0;
        border-radius: 7px;
        background: #1677ff;
        color: white;
        cursor: pointer;
        font-size: 13px;
      }

      #anitabi-google-export-panel .age-btn:hover {
        filter: brightness(0.95);
      }

      #anitabi-google-export-panel .age-status {
        margin-top: 7px;
        font-size: 12px;
        line-height: 1.4;
        color: #555;
        word-break: break-all;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(panel);

    statusEl = panel.querySelector(".age-status");

    panel.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-format]");
      if (!btn) return;

      const buttons = panel.querySelectorAll("button");
      buttons.forEach(b => b.disabled = true);

      try {
        await exportCurrent(btn.dataset.format);
      } finally {
        buttons.forEach(b => b.disabled = false);
      }
    });
  }

  function boot() {
    createPanel();

    // SPA 页面可能不会完整刷新，所以监听 URL 变化后更新提示
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        const ids = getBangumiIdsFromUrl();
        setStatus(ids.length ? `当前作品：${ids.join(", ")}` : "未检测到 bangumiId");
      }
    }, 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();