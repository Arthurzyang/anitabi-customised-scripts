// ==UserScript==
// @name         Anitabi Multi-Anime Integration
// @namespace    https://anitabi.cn/
// @version      0.5
// @description  多作品整合视图：加入/整合/清空
// @match        https://anitabi.cn/map*
// @require      https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/turf.min.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {

  'use strict';



  /* ============ 常量 ============ */

  const LS_KEY = 'anitabi_multi_hull_ids';
  const BTN_STYLE = 'padding:2px 6px;margin:2px;font-size:12px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;';
  const COLORS = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93'];



  /* ============ 列表操作 ============ */

  const getIds = () => JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  const setIds = ids => localStorage.setItem(LS_KEY, JSON.stringify(ids));
  const addId = id => { const ids = getIds(); if (!ids.includes(id)) { ids.push(id); setIds(ids); } return ids.length; };
  const clearIds = () => localStorage.removeItem(LS_KEY);



  /* ============ 地图辅助 ============ */

  const map = () => window.map;
  const toggleOfficial = vis => {
    map().getStyle().layers.forEach(l=>{
      if(/points|cluster|symbol/i.test(l.id))
        map().setLayoutProperty(l.id,'visibility',vis?'visible':'none');
    });
  };



  /* ============ 联合视图 ============ */

  let integrated = false;

  async function buildView () {
    const ids = getIds();
    if(!ids.length){alert('列表还是空的哦~');return;}

    /* 拉点 */
    const feats=[];
    for(const [i,sid] of ids.entries()){
      const res=await fetch(`https://api.anitabi.cn/bangumi/${sid}/points/detail`);
      (await res.json()).forEach(p=>{
        feats.push(turf.point([p.geo[1],p.geo[0]],{color:COLORS[i%COLORS.length]}));
      });
    }

    const hull=turf.convex(turf.featureCollection(feats));
    if(!hull){alert('生成凸包失败');return;}

    toggleOfficial(false);

    ['multiPoints','multiHull'].forEach(id=>{
      if(map().getSource(id)){
        map().removeLayer(`${id}-layer`); map().removeSource(id);
      }
    });

    map().addSource('multiPoints',{type:'geojson',data:turf.featureCollection(feats)});
    map().addLayer({id:'multiPoints-layer',type:'circle',source:'multiPoints',
      paint:{'circle-radius':4,'circle-color':['get','color'],'circle-stroke-width':1,'circle-stroke-color':'#fff'}});
    map().addSource('multiHull',{type:'geojson',data:hull});
    map().addLayer({id:'multiHull-layer',type:'fill',source:'multiHull',
      paint:{'fill-color':'#66ccff','fill-opacity':0.15}});

    map().fitBounds([[...turf.bbox(hull).slice(0,2)],[...turf.bbox(hull).slice(2)]],{padding:60});
    integrated=true;
  }

  function exitView (){
    ['multiPoints','multiHull'].forEach(id=>{
      if(map().getSource(id)){
        map().removeLayer(`${id}-layer`);map().removeSource(id);
      }
    });
    toggleOfficial(true);
    integrated=false;
  }



  /* ============ 卡片按钮 ============ */

  function injectButtons(el){

    if(el.querySelector('.multi-hull-toolbar'))return;
    const bid=new URLSearchParams(location.search).get('bangumiId'); if(!bid)return;

    const bar=document.createElement('div'); bar.className='multi-hull-toolbar'; bar.style.marginTop='8px';

    const btnAdd=document.createElement('button');
    btnAdd.textContent='将作品加入列表';
    btnAdd.style=BTN_STYLE;
    btnAdd.onclick=()=>{
      const n=addId(bid);
      btnInt.textContent=`整合多作品范围 (${n})`;
      btnAdd.textContent='✓ 已加入'; btnAdd.disabled=true;
    };

    const btnInt=document.createElement('button');
    btnInt.textContent=`整合多作品范围 (${getIds().length})`;
    btnInt.style=BTN_STYLE;
    btnInt.onclick=()=> integrated?exitView():buildView();

    const btnClr=document.createElement('button');
    btnClr.textContent='清空列表';
    btnClr.style=BTN_STYLE+'background:#ffe6e6;';
    btnClr.onclick=()=>{
      clearIds();
      exitView();
      btnInt.textContent='整合列表作品 (0)';
      alert('已清空！');
    };

    bar.append(btnAdd,btnInt,btnClr);
    el.appendChild(bar);
  }



  /* ============ 监听弹窗 ============ */

  new MutationObserver(ms=>{
    ms.forEach(r=>{
      r.addedNodes.forEach(n=>{
        if(n.nodeType===1&&n.matches('.mapboxgl-popup-content')) injectButtons(n);
      });
    });
  }).observe(document.body,{childList:true,subtree:true});

})();
