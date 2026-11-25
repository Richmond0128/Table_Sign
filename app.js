(function(){
"use strict";

/* 版面全部用 canvas 畫：預覽與輸出共用同一個 drawSheet()，所以看到什麼就印出什麼；
   輸出 PDF 時以 300dpi 把每張 A4 畫成圖片再用 pdf-lib 組成 PDF（不需要嵌入中文字型）。 */

var A4W = 210, A4H = 297, PT = 25.4/72;   // 1pt = 0.3528mm
var FONT_NAMES = {   // 使用裝置上的系統字型（要偵測有沒有安裝）
  kai:  ["DFKai-SB","BiauKai","Kaiti TC","標楷體","KaiTi","STKaiti"],
  hei:  ["Microsoft JhengHei","微軟正黑體","PingFang TC","Noto Sans TC"],
  ming: ["PMingLiU","新細明體","Songti TC","Noto Serif TC"]
};
var FONT_LABEL = {kai:"標楷體", hei:"微軟正黑體", ming:"新細明體"};
var GENERIC = {kai:"serif", hei:"sans-serif", ming:"serif"};
var FONTS = {};
Object.keys(FONT_NAMES).forEach(function(k){
  FONTS[k] = FONT_NAMES[k].map(function(n){ return '"' + n + '"'; }).join(",") + "," + GENERIC[k];
});
// 內建的「全字庫正楷體」：網站自己提供的切片網頁字型（fonts/twkai/twkai.css）。
// 後面接系統楷體，是給切片沒有的字（例如第 2 字面以上的罕見字）當備用。
var TWKAI = "twkai";
FONTS[TWKAI] = '"TW-Kai-Web",' + FONTS.kai;

var SLIDERS = [
  {k:"nameSize",  label:"姓名字級", min:24, max:160, step:1,    unit:"pt"},
  {k:"titleSize", label:"職稱字級", min:12, max:100, step:1,    unit:"pt"},
  {k:"nameSp",    label:"姓名字距", min:0,  max:1,   step:0.05, unit:"em"},
  {k:"titleSp",   label:"職稱字距", min:0,  max:1,   step:0.05, unit:"em"}
];
// 職稱選「自訂」時才出現：左右依「左右基準」而定；上下 = 職稱上緣離該格頂端的距離
var CUSTOM_SLIDERS = [
  {k:"titleX", label:"職稱左右位置", min:-105, max:105, step:1, unit:"mm"},
  {k:"titleY", label:"職稱上下位置", min:0,    max:100, step:1, unit:"mm"}
];
// 姓名選「自訂」時才出現：相對於「置中」位置的移動量（右、下為正）
var NAME_SLIDERS = [
  {k:"nameX", label:"姓名左右位置", min:-105, max:105, step:1, unit:"mm"},
  {k:"nameY", label:"姓名上下位置", min:-60,  max:60,  step:1, unit:"mm"}
];
var ANCHOR_RANGE = {center:[-105,105], left:[0,210], right:[0,210]};
var TITLE_TOP = 8;      // 靠左／置中／靠右時，職稱上緣離該格頂端的 mm 數
var SIDE_MARGIN = 15;   // 靠左／靠右時，職稱離紙邊的 mm 數
var S = {nameSize:80, titleSize:40, nameSp:0.15, titleSp:0.05, titleX:0, titleY:TITLE_TOP, nameX:0, nameY:0};
var T = {folds:3, people:[], page:0, busy:false};
var tAnchor = "center";   // 自訂模式下，「左右位置」是以職稱的 center / left / right 為準

function $(id){ return document.getElementById(id); }
var cv = $("cv");

/* ---------- 版面計算 ---------- */
var mctx = document.createElement("canvas").getContext("2d");
function fontStr(px, bold){ return (bold?"bold ":"") + px + "px " + FONTS[$("font").value]; }
// 在 100px 時量出每個字的寬度總和，之後依字級等比例換算
function textEm(text, bold){
  mctx.font = fontStr(100, bold);
  var w = 0; Array.from(text).forEach(function(ch){ w += mctx.measureText(ch).width; });
  return w / 100;
}
function widthMm(text, sizePt, sp, bold){
  var n = Array.from(text).length; if(!n) return 0;
  return (textEm(text, bold) + sp*(n-1)) * sizePt * PT;
}
function layout(p){
  var ph = A4H / T.folds, maxW = A4W - 24, maxH = ph - 8;
  var ns = p.ns || S.nameSize, ts = p.ts || S.titleSize, shrunk = false;
  var nb = $("nameBold").checked, tb = $("titleBold").checked;
  if($("autofit").checked){   // 姓名與職稱各自縮放，互不影響
    var nw = widthMm(p.name, ns, S.nameSp, nb), tw = widthMm(p.title, ts, S.titleSp, tb);
    if(nw > maxW){ ns *= maxW/nw; shrunk = true; }
    if(tw > maxW){ ts *= maxW/tw; shrunk = true; }
    if(ns*PT > maxH){ ns = maxH/PT; shrunk = true; }
    if(ts*PT > maxH){ ts = maxH/PT; shrunk = true; }
  }
  return {ns:ns, ts:ts, shrunk:shrunk};
}
// 職稱左上角位置（mm，以該桌牌面朝上時的座標，原點在該格左上角）
function titleBox(p, L, ph, align){
  var w = widthMm(p.title, L.ts, S.titleSp, $("titleBold").checked), h = L.ts*PT, x, y = TITLE_TOP;
  if(align === "left") x = SIDE_MARGIN;
  else if(align === "right") x = A4W - SIDE_MARGIN - w;
  else if(align === "custom"){
    if(tAnchor === "left") x = S.titleX;
    else if(tAnchor === "right") x = A4W - S.titleX - w;
    else x = (A4W - w)/2 + S.titleX;
    y = S.titleY;
  } else x = (A4W - w)/2;
  x = Math.max(3, Math.min(x, A4W - 3 - w));      // 不超出紙邊
  y = Math.max(0, Math.min(y, ph - h));            // 不超出該格
  return {x:x, y:y, w:w, h:h};
}
// 姓名中心位置與大小（mm，座標同 titleBox）：預設在該格正中央，「自訂」時加上左右、上下偏移
function nameBox(p, L, ph, align){
  var w = widthMm(p.name, L.ns, S.nameSp, $("nameBold").checked), h = L.ns*PT;
  var cx = A4W/2 + (align === "custom" ? S.nameX : 0);
  var cy = ph/2   + (align === "custom" ? S.nameY : 0);
  cx = w > A4W-6 ? A4W/2 : Math.max(3 + w/2, Math.min(cx, A4W - 3 - w/2));   // 不超出紙邊
  cy = h > ph    ? ph/2   : Math.max(h/2, Math.min(cy, ph - h/2));           // 不超出該格
  return {cx:cx, cy:cy, w:w, h:h};
}
// 這個人目前有哪些版面問題（自動縮小、姓名與職稱重疊）
function issues(p){
  var out = [], ph = A4H/T.folds, L = layout(p);
  if($("font").value === TWKAI){   // 內建字型只含 Unicode 基本字面（BMP），更罕見的字會退回裝置上的字型
    var rare = Array.from(p.name + p.title).filter(function(c){ return c.codePointAt(0) > 0xFFFF; });
    if(rare.length) out.push("含內建字型沒有的罕見字「" + rare.join("") + "」，這些字會改用裝置上的字型，可能顯示成方框或不同字體");
  }
  if(L.shrunk) out.push("字太長，已自動縮小（姓名 "+Math.round(L.ns)+"pt／職稱 "+Math.round(L.ts)+"pt）");
  if(p.name && p.title){
    var nbx = nameBox(p, L, ph, $("nameAlign").value);
    var nw = nbx.w, nh = nbx.h*0.9;   // 0.9：字框比實際筆畫略大
    var nx = nbx.cx - nw/2, ny = nbx.cy - nh/2;
    var tb = titleBox(p, L, ph, $("titleAlign").value), th = tb.h*0.9, ty = tb.y + (tb.h-th)/2;
    if(nx < tb.x+tb.w && tb.x < nx+nw && ny < ty+th && ty < ny+nh) out.push("姓名與職稱重疊");
  }
  return out;
}

/* ---------- 繪製 ---------- */
// anchor："center" 時 x0 是文字中心；"left" 時 x0 是文字左緣
function drawText(ctx, text, x0, cy, sizePx, spEm, bold, anchor){
  var chars = Array.from(text); if(!chars.length) return;
  ctx.font = fontStr(sizePx, bold);
  var ws = chars.map(function(c){ return ctx.measureText(c).width; });
  var sp = spEm * sizePx, total = ws.reduce(function(a,b){return a+b;},0) + sp*(chars.length-1);
  var x = anchor === "left" ? x0 : x0 - total/2;
  chars.forEach(function(c,i){ ctx.fillText(c, x, cy); x += ws[i] + sp; });
}
function drawFace(ctx, ppm, p, panel, ph, rotated){
  var cx = A4W/2*ppm, cy = (panel+0.5)*ph*ppm;
  var L = layout(p), ptpx = PT*ppm;
  ctx.save();
  if(rotated){ ctx.translate(cx,cy); ctx.rotate(Math.PI); ctx.translate(-cx,-cy); }
  ctx.fillStyle = "#000"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  // 姓名：預設在該格正中央（可自訂偏移），字級不影響職稱位置
  if(p.name){
    var nb = nameBox(p, L, ph, $("nameAlign").value);
    drawText(ctx, p.name, nb.cx*ppm, (panel*ph + nb.cy)*ppm, L.ns*ptpx, S.nameSp, $("nameBold").checked, "center");
  }
  // 職稱：位置獨立計算
  if(p.title){
    var tb = titleBox(p, L, ph, $("titleAlign").value);
    drawText(ctx, p.title, tb.x*ppm, (panel*ph + tb.y + tb.h/2)*ppm, L.ts*ptpx, S.titleSp, $("titleBold").checked, "left");
  }
  ctx.restore();
}
function perSheet(){ return T.folds === 4 ? 2 : 1; }
function sheetGroups(){
  var per = perSheet(), out = [];
  for(var i=0;i<T.people.length;i+=per) out.push(T.people.slice(i,i+per));
  return out;
}
function drawSheet(ctx, ppm, group, forExport){
  var n = T.folds, ph = A4H/n;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,A4W*ppm,A4H*ppm);
  group.forEach(function(p,t){
    drawFace(ctx, ppm, p, t*2,   ph, true);   // 反面（旋轉 180°）
    drawFace(ctx, ppm, p, t*2+1, ph, false);  // 正面
  });
  if(!forExport){
    for(var i=group.length*2;i<n;i++){
      ctx.fillStyle = "rgba(0,0,0,.04)"; ctx.fillRect(0,i*ph*ppm,A4W*ppm,ph*ppm);
      ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.font = (4*ppm)+"px sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(n===3 && i===2 ? "黏合底（留白）" : "（空白）", A4W/2*ppm, (i+0.5)*ph*ppm);
    }
  }
  // 折線（虛線）與裁切線（實線，只有四折式中間那條）可各自開關
  var showFold = $("foldLines").checked, showCut = $("cutLines").checked && n === 4;
  ctx.save(); ctx.strokeStyle = "#b5b9c2"; ctx.lineWidth = Math.max(1,0.25*ppm);
  for(var b=1;b<n;b++){
    var cut = (n===4 && b===2);          // 四折式中間 = 兩個桌牌的裁切線
    if(cut ? !showCut : !showFold) continue;
    ctx.setLineDash(cut ? [] : [2.5*ppm,2*ppm]);
    ctx.beginPath(); ctx.moveTo(0,b*ph*ppm); ctx.lineTo(A4W*ppm,b*ph*ppm); ctx.stroke();
  }
  ctx.restore();
}

/* ---------- 預覽 ---------- */
var raf = 0;
function schedule(){ cancelAnimationFrame(raf); raf = requestAnimationFrame(renderPreview); saveSettings(); }

/* ---------- 內建字型（全字庫正楷體切片）的載入 ----------
   字型被切成很多小檔，瀏覽器只會下載「用到的字」所在的那幾片。canvas 不會等字型，
   所以要先 document.fonts.load()，載入完再重畫；否則會先畫成備用字型。 */
var twRequested = {};   // 已經要求載入過的字（成功或失敗都不再重試，避免重複請求或無限重畫）
var twBusy = 0;
function allText(){
  return T.people.map(function(p){ return p.name + p.title; }).join("");
}
function ensureTwKai(){
  if($("font").value !== TWKAI) return;
  var need = Array.from(allText()).filter(function(c){ return c.trim() && !twRequested[c]; });
  if(!need.length) return;
  need.forEach(function(c){ twRequested[c] = true; });
  twBusy++; $("fontStatus").hidden = false;
  document.fonts.load('40px "TW-Kai-Web"', need.join("")).catch(function(){}).then(function(){
    twBusy--; if(!twBusy) $("fontStatus").hidden = true;
    schedule();   // 載入完成，用正確字型重畫
  });
}
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function renderPreview(){
  ensureTwKai();
  var groups = sheetGroups(), N = groups.length;
  T.page = Math.min(Math.max(T.page,0), Math.max(N-1,0));
  var ppm = 3;
  cv.width = Math.round(A4W*ppm); cv.height = Math.round(A4H*ppm);
  var ctx = cv.getContext("2d");
  if(!N){
    ctx.fillStyle = "#fff"; ctx.fillRect(0,0,cv.width,cv.height);
    ctx.fillStyle = "#999"; ctx.font = "20px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("請先貼上名單，或按「範例」看看效果", cv.width/2, cv.height/2);
  } else drawSheet(ctx, ppm, groups[T.page], false);
  $("pageno").textContent = N ? ("第 "+(T.page+1)+" / "+N+" 張") : "—";
  $("prev").disabled = T.page<=0; $("next").disabled = T.page>=N-1;
  $("btnPdf").disabled = !N || T.busy;
  $("legend").textContent = "虛線＝折線" + (T.folds===4 ? "、實線＝兩個桌牌的裁切線" : "") +
    "（可在「字體與位置」分別選擇要不要印）。每個桌牌的反面（旋轉 180°）與正面以折線對稱。";
  $("count").textContent = T.people.length + " 人・共 " + N + " 張 A4";
  var cur = T.page*perSheet(), msgs = [];
  Array.prototype.forEach.call($("list").querySelectorAll(".lrow[data-i]"), function(r){
    var i = +r.dataset.i; r.classList.toggle("cur", i>=cur && i<cur+perSheet());
    var w = r.querySelector(".n"), iss = issues(T.people[i]);
    w.classList.toggle("warn", iss.length>0);
    w.textContent = iss.length ? "⚠" : (i+1);
    w.title = iss.join("；");
    if(i>=cur && i<cur+perSheet() && iss.length) msgs.push("第 "+(i+1)+" 位 "+(T.people[i].name||"（無姓名）")+"：" + iss.join("；"));
  });
  $("warnbar").hidden = !msgs.length;
  $("warnbar").innerHTML = msgs.map(function(m){ return "⚠ " + escapeHtml(m); }).join("<br>");
}
$("prev").addEventListener("click", function(){ T.page--; schedule(); });
$("next").addEventListener("click", function(){ T.page++; schedule(); });

/* ---------- 名單 ---------- */
function parseLines(text){
  var out = [];
  text.replace(/^﻿/,"").split(/\r?\n/).forEach(function(line){
    line = line.trim(); if(!line) return;
    var parts;
    if(line.indexOf("\t")>=0) parts = line.split("\t");
    else if(/[,，]/.test(line)) parts = line.split(/[,，]/);
    else { var m = line.match(/^(\S+)\s+(.+)$/); parts = m ? [m[1], m[2]] : [line]; }
    parts = parts.map(function(s){ return s.trim().replace(/^"(.*)"$/,"$1").trim(); });
    if(!parts[0] && !parts[1]) return;
    out.push({name:parts[0]||"", title:parts.slice(1).join(" ").trim()});
  });
  if(out.length && /^(姓名|名字|name)$/i.test(out[0].name)) out.shift();   // 略過標題列
  return out;
}
function buildList(){
  var box = $("list"); box.innerHTML = "";
  if(!T.people.length){ box.innerHTML = '<div class="empty">尚無資料，請在上方貼上名單</div>'; schedule(); return; }
  var head = document.createElement("div"); head.className = "lrow head";
  head.innerHTML = "<span></span><span>姓名</span><span>職稱</span><span>姓名pt</span><span>職稱pt</span><span></span>";
  box.appendChild(head);
  T.people.forEach(function(p,i){
    var r = document.createElement("div"); r.className = "lrow"; r.dataset.i = i;
    var n = document.createElement("span"); n.className = "n"; n.textContent = i+1;
    function txt(key, ph){ var e = document.createElement("input"); e.type = "text"; e.value = p[key]; e.placeholder = ph;
      e.addEventListener("input", function(){ p[key] = e.value.trim(); schedule(); }); return e; }
    function num(key, ph, cls){ var e = document.createElement("input"); e.type = "number"; e.min = 8; e.max = 200; e.placeholder = ph; e.className = cls;
      if(p[key]) e.value = p[key];
      e.addEventListener("input", function(){ var v = parseFloat(e.value); p[key] = v>0 ? v : 0; schedule(); }); return e; }
    var x = document.createElement("button"); x.className = "x"; x.textContent = "✕"; x.title = "刪除"; x.setAttribute("aria-label", "刪除這一筆");
    x.addEventListener("click", function(){ T.people.splice(i,1); buildList(); });
    r.appendChild(n); r.appendChild(txt("name","姓名")); r.appendChild(txt("title","職稱"));
    r.appendChild(num("ns","姓名pt","pt-n")); r.appendChild(num("ts","職稱pt","pt-t")); r.appendChild(x);
    r.addEventListener("focusin", function(){ T.page = Math.floor(i/perSheet()); schedule(); });
    box.appendChild(r);
  });
  schedule();
}
function addPeople(list, replace){
  if(!list.length){ toast("沒有讀到資料"); return; }
  if(replace) T.people = [];
  list.forEach(function(p){ T.people.push({name:p.name, title:p.title, ns:0, ts:0}); });
  T.page = replace ? 0 : Math.floor((T.people.length-1)/perSheet());
  buildList(); toast("已匯入 " + list.length + " 筆");
}
$("btnAdd").addEventListener("click", function(){ addPeople(parseLines($("paste").value), false); $("paste").value = ""; });
$("btnReplace").addEventListener("click", function(){ addPeople(parseLines($("paste").value), true); $("paste").value = ""; });
$("btnFile").addEventListener("click", function(){ $("file").click(); });
$("file").addEventListener("change", function(){
  var input = this, f = input.files[0]; if(!f) return;
  f.arrayBuffer().then(function(buf){
    var text;
    try{ text = new TextDecoder("utf-8",{fatal:true}).decode(buf); }
    catch(e){ text = new TextDecoder("big5").decode(buf); }   // Excel 另存 CSV 常見的 Big5
    addPeople(parseLines(text), false);
  });
  input.value = "";
});
// 清空要按兩次（不用原生 confirm()，iOS 加入主畫面的獨立模式下原生對話框會靜默失效）
var clearTimer = 0;
$("btnClear").addEventListener("click", function(){
  var btn = this;
  if(!T.people.length) return;
  if(!clearTimer){
    btn.textContent = "再按一次確認清空";
    clearTimer = setTimeout(function(){ clearTimer = 0; btn.textContent = "清空名單"; }, 3000);
    return;
  }
  clearTimeout(clearTimer); clearTimer = 0; btn.textContent = "清空名單";
  T.people = []; buildList();
});
var SAMPLE = "王小明\t校長\n李小強\t教務長\n陳小名\t學生事務長\n林小偉\t學務處生活輔導組組長\n黃小華\t主任秘書\n歐陽小美\t副學務長";
$("btnSample").addEventListener("click", function(){ addPeople(parseLines(SAMPLE), true); });

/* ---------- 折數 / 控制項 ---------- */
var FOLD_HINT = {
  2:"每張 A4 一個桌牌：上半反面（旋轉）、下半正面。",
  3:"每張 A4 一個桌牌：上格反面、中格正面、最下格留白當黏合底。",
  4:"每張 A4 兩個桌牌（名單中連續兩人）；人數是單數時，最後一張只放一人。"
};
function setFold(n){
  T.folds = n;
  Array.prototype.forEach.call(document.querySelectorAll(".fold"), function(l){ l.classList.toggle("on", +l.dataset.f===n); });
  $("foldHint").textContent = FOLD_HINT[n];
  $("cutLines").disabled = (n !== 4);   // 只有四折式才有裁切線
  $("cutLabel").style.opacity = n === 4 ? "" : "0.5";
  T.page = Math.min(T.page, Math.max(sheetGroups().length-1, 0));
  schedule();
}
Array.prototype.forEach.call(document.querySelectorAll(".fold input"), function(i){
  i.addEventListener("change", function(){ setFold(+i.value); });
});

var sliderInputs = {};   // k -> {rg, nb}，程式需要改滑桿值時用
function addSlider(d, box){
  var w = document.createElement("div"); w.className = "ctl";
  var lab = document.createElement("span"); lab.textContent = d.label;
  var rg = document.createElement("input"); rg.type = "range"; rg.min = d.min; rg.max = d.max; rg.step = d.step; rg.value = S[d.k];
  rg.setAttribute("aria-label", d.label);
  var u = document.createElement("span"); u.className = "u";
  var nb = document.createElement("input"); nb.type = "number"; nb.min = d.min; nb.max = d.max; nb.step = d.step; nb.value = S[d.k];
  nb.setAttribute("aria-label", d.label + "（數字）");
  u.appendChild(nb); u.appendChild(document.createTextNode(d.unit));
  function set(v){ v = parseFloat(v); if(isNaN(v)) return; S[d.k] = v; schedule(); }
  rg.addEventListener("input", function(){ nb.value = rg.value; set(rg.value); });
  nb.addEventListener("input", function(){ rg.value = nb.value; set(nb.value); });
  w.appendChild(lab); w.appendChild(rg); w.appendChild(u); box.appendChild(w);
  sliderInputs[d.k] = {rg:rg, nb:nb};
}
function setSlider(k, v){ var s = sliderInputs[k]; S[k] = v; s.rg.value = v; s.nb.value = v; }
SLIDERS.forEach(function(d){ addSlider(d, $("ctls")); });
CUSTOM_SLIDERS.forEach(function(d){ addSlider(d, $("customPos")); });
NAME_SLIDERS.forEach(function(d){ addSlider(d, $("customName")); });
// 姓名位置：「自訂」是從置中位置開始偏移，所以切換時畫面不會跳動
$("nameAlign").addEventListener("change", function(){
  $("customName").hidden = (this.value !== "custom");
  schedule();
});

// 字型：偵測這台裝置有沒有安裝，沒有的話提醒（會改用備用字型，印出來會不一樣）
function fontInstalled(names){
  var c = document.createElement("canvas").getContext("2d"), t = "ABCabc123 標楷體測試";
  return names.some(function(n){
    c.font = '40px "' + n + '", monospace'; var a = c.measureText(t).width;
    c.font = '40px "' + n + '", serif';     var b = c.measureText(t).width;
    return a === b;   // 字型存在時，不論備用字型是什麼，寬度都一樣
  });
}
function updateFontHint(){
  var k = $("font").value;
  if(k === TWKAI){ $("fontHint").hidden = true; return; }   // 內建字型不依賴裝置
  var ok = fontInstalled(FONT_NAMES[k]);
  $("fontHint").hidden = ok;
  if(!ok) $("fontHint").textContent = "這台裝置似乎沒有「" + FONT_LABEL[k] + "」，預覽與 PDF 會改用其他字型，印出來的樣子會不一樣。";
}
$("font").addEventListener("change", function(){ updateFontHint(); schedule(); });
["nameBold","titleBold","autofit","foldLines","cutLines"].forEach(function(id){ $(id).addEventListener("change", schedule); });

// 把「職稱實際位置」換算成各基準下的左右數值
function xFromBox(tb, a){
  if(a === "left") return Math.round(tb.x);
  if(a === "right") return Math.round(A4W - tb.x - tb.w);
  return Math.round(tb.x + tb.w/2 - A4W/2);
}
function firstTitled(){ var g = sheetGroups()[T.page]; return g && g[0] && g[0].title ? g[0] : null; }
function applyAnchorRange(a){
  var r = ANCHOR_RANGE[a], s = sliderInputs.titleX;
  s.rg.min = s.nb.min = r[0]; s.rg.max = s.nb.max = r[1];
}
// 職稱位置：切到「自訂」時，從目前這頁第一位的實際位置開始，畫面不會突然跳掉
var lastAlign = "left";
$("titleAlign").addEventListener("change", function(){
  var v = this.value, p = firstTitled();
  if(v === "custom" && lastAlign !== "custom" && p){
    var tb = titleBox(p, layout(p), A4H/T.folds, lastAlign);
    setSlider("titleX", xFromBox(tb, tAnchor));
    setSlider("titleY", Math.round(tb.y));
  }
  lastAlign = v;
  $("customPos").hidden = (v !== "custom");
  schedule();
});
$("titleAnchor").addEventListener("change", function(){
  var next = this.value, p = firstTitled(), tb = null;
  if(p) tb = titleBox(p, layout(p), A4H/T.folds, "custom");   // 換基準前的實際位置
  tAnchor = next;
  applyAnchorRange(next);
  setSlider("titleX", tb ? xFromBox(tb, next) : 0);
  schedule();
});

/* ---------- 設定記憶（只記設定，不記名單） ---------- */
var KEY = "table_sign_settings_v1";
function saveSettings(){
  try{
    localStorage.setItem(KEY, JSON.stringify({
      folds:T.folds, S:S, font:$("font").value, align:$("titleAlign").value, nameAlign:$("nameAlign").value, anchor:tAnchor,
      nameBold:$("nameBold").checked, titleBold:$("titleBold").checked, autofit:$("autofit").checked,
      foldLines:$("foldLines").checked, cutLines:$("cutLines").checked
    }));
  }catch(e){}
}
function loadSettings(){
  var j = null;
  try{ j = JSON.parse(localStorage.getItem(KEY)); }catch(e){}
  if(!j || typeof j !== "object") return;
  if([2,3,4].indexOf(j.folds) >= 0) T.folds = j.folds;
  if(FONTS[j.font]) $("font").value = j.font;
  if(["left","center","right","custom"].indexOf(j.align) >= 0) $("titleAlign").value = j.align;
  if(["center","custom"].indexOf(j.nameAlign) >= 0) $("nameAlign").value = j.nameAlign;
  if(ANCHOR_RANGE[j.anchor]){ tAnchor = j.anchor; $("titleAnchor").value = j.anchor; applyAnchorRange(j.anchor); }
  ["nameBold","titleBold","autofit","foldLines","cutLines"].forEach(function(id){
    if(typeof j[id] === "boolean") $(id).checked = j[id];
  });
  if(j.S && typeof j.S === "object"){
    SLIDERS.concat(CUSTOM_SLIDERS, NAME_SLIDERS).forEach(function(d){
      var v = parseFloat(j.S[d.k]); if(isNaN(v)) return;
      var r = d.k === "titleX" ? ANCHOR_RANGE[tAnchor] : [d.min, d.max];
      setSlider(d.k, Math.min(r[1], Math.max(r[0], v)));
    });
  }
}

/* ---------- 輸出 PDF ---------- */
var pdfLibPromise = null;
function loadPdfLib(){
  if(window.PDFLib) return Promise.resolve();
  if(pdfLibPromise) return pdfLibPromise;
  pdfLibPromise = new Promise(function(res, rej){
    var s = document.createElement("script");
    s.src = "vendor/pdf-lib.min.js";
    s.onload = res;
    s.onerror = function(){ pdfLibPromise = null; rej(new Error("PDF 元件載入失敗，請確認網路連線後再試")); };
    document.head.appendChild(s);
  });
  return pdfLibPromise;
}
function pad(n){ return n<10 ? "0"+n : ""+n; }
function buildPdf(onProgress){
  var groups = sheetGroups(), ppm = 300/25.4;
  var off = document.createElement("canvas"); off.width = Math.round(A4W*ppm); off.height = Math.round(A4H*ppm);
  var ctx = off.getContext("2d");
  // 內建字型：確認名單裡用到的字都載入完成才開始畫（載入失敗就會用備用字型，不會卡住）
  var fontReady = ($("font").value === TWKAI)
    ? document.fonts.load('40px "TW-Kai-Web"', allText()).catch(function(){})
    : Promise.resolve();
  return fontReady.then(loadPdfLib).then(function(){ return PDFLib.PDFDocument.create(); }).then(function(doc){
    var chain = Promise.resolve();
    groups.forEach(function(g, idx){
      chain = chain.then(function(){
        drawSheet(ctx, ppm, g, true);
        return new Promise(function(res){ off.toBlob(res, "image/png"); })
          .then(function(b){ return b.arrayBuffer(); })
          .then(function(buf){ return doc.embedPng(buf); })
          .then(function(img){
            var page = doc.addPage([595.28, 841.89]);
            page.drawImage(img, {x:0, y:0, width:595.28, height:841.89});
            onProgress(idx+1, groups.length);
            return new Promise(function(r){ setTimeout(r, 0); });  // 讓按鈕上的進度文字有機會先畫出來
          });
      });
    });
    return chain.then(function(){ return doc.save(); });
  });
}
$("btnPdf").addEventListener("click", function(){
  if(T.busy || !T.people.length) return;
  var btn = this; T.busy = true; btn.disabled = true;
  buildPdf(function(i, n){ btn.textContent = "產生中 " + i + " / " + n; }).then(function(bytes){
    var d = new Date(), a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([bytes], {type:"application/pdf"}));
    a.download = "桌牌_" + d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + ".pdf";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 10000);
    toast("PDF 已產生（" + Math.round(bytes.length/1024) + " KB），開始下載");
  }).catch(function(err){
    toast("輸出失敗：" + (err && err.message ? err.message : "未知錯誤"));
  }).then(function(){
    T.busy = false; btn.textContent = "⬇ 下載 PDF"; btn.disabled = !T.people.length;
  });
});

var toastTimer = 0;
function toast(msg){
  var t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove("show"); }, 2200);
}

/* ---------- 啟動 ---------- */
loadSettings();
var checkedFold = document.querySelector('.fold input[value="' + T.folds + '"]');
if(checkedFold) checkedFold.checked = true;
lastAlign = $("titleAlign").value;
$("customPos").hidden = (lastAlign !== "custom");
$("customName").hidden = ($("nameAlign").value !== "custom");
updateFontHint();
setFold(T.folds);
buildList();
})();
