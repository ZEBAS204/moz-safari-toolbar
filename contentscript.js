/*
    Firefox addon "Save Screenshot"
    Copyright (C) 2021  Manuel Reimer <manuel.reimer@gmx.de>
    Copyright (C) 2022  Jak.W <https://github.com/jakwings/firefox-screenshot>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

// https://www.w3.org/TR/2016/WD-cssom-view-1-20160317/#dom-element-clientheight
// https://www.w3.org/TR/2016/WD-cssom-view-1-20160317/#dom-document-scrollingelement
// https://dom.spec.whatwg.org/#dom-document-compatmode
// TODO: take a screenshot of an iframe or any scrolling element
// FIXME: zoom level
function GetPageInfo() {
  const root = document.documentElement;
  const page = document.scrollingElement || root;
  const {clientWidth: cw, clientHeight: ch} = root;
  const {scrollWidth: sw, scrollHeight: sh} = page;
  const {innerWidth: ww, innerHeight: wh} = window;
  const {scrollX: sx, scrollY: sy} = window;

  const body = document.body || page;
  const root_style = window.getComputedStyle(root);
  const body_style = window.getComputedStyle(body);

  // scrollWidth|scrollHeight is *programmatically* scrollable area
  // overflow:clip limits programmatic scrolling but does not change js values
  let isClipped = (s) => /^(?:hidden|clip)$/.test(s);
  let [pw, ph] = [Math.max(sw || cw, cw), Math.max(sh || ch, ch)];

  if (isClipped(root_style.overflowX) || isClipped(body_style.overflowX)) {
    pw = cw;
  }
  if (isClipped(root_style.overflowY) || isClipped(body_style.overflowY)) {
    ph = ch;
  }

  return {
    ww, wh, cw, ch, sx, sy,
    sw: pw,
    sh: ph,
    bw: ww - cw,
    bh: wh - ch,
    dx: sx < 0 || (window.scrollMaxX <= 0 && sw > cw) ? -1 : 1,
    dy: sy < 0 || (window.scrollMaxY <= 0 && sh > ch) ? -1 : 1,
  };
}

function Select() {
  const overlay = document.createElement('div');
  const selection = document.createElement('div');
  const style = document.createElement('style');
  overlay.appendChild(style);
  overlay.appendChild(selection);
  (document.body || document.documentElement).appendChild(overlay);

  let now = Date.now();
  style.id = 'screenshot-style-' + now;
  overlay.id = 'screenshot-overlay-' + now;
  selection.id = 'screenshot-selection-' + now;
  selection.dataset.w = 0;
  selection.dataset.h = 0;

  // https://kovart.github.io/dashed-border-generator/
  // https://developer.mozilla.org/en-US/docs/Web/SVG/Content_type
  // https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URIs
  // https://stackoverflow.com/questions/7241393/can-you-control-how-an-svgs-stroke-width-is-drawn
  style.textContent = `
    #${overlay.id}, #${overlay.id} * {
      all: initial !important;
    }
    :root *, :root #${overlay.id}, :root #${overlay.id} * {
      cursor: crosshair !important;
    }
    :root #${style.id} {
      display: none !important;
    }
    :root #${overlay.id} {
      position: fixed !important;
      left: 0 !important;
      top: 0 !important;
      height: 100% !important;
      width: 100% !important;
      z-index: 2147483647 !important;
    }
    :root #${selection.id} {
      position: absolute !important;
    }
    :root #${selection.id}::after {
      content: attr(data-w) "x" attr(data-h) !important;
      position: absolute !important;
      left: 1px !important;
      top: 1px !important;
      font: bold 12px monospace !important;
      color: #000 !important;
      text-shadow: 1px 1px 0 #fff, 1px -1px 0 #fff, -1px -1px 0 #fff, -1px 1px 0 #fff, 1px 0 0 #fff, 0 -1px 0 #fff, -1px 0 0 #fff, 0 1px 0 #fff !important;
    }
    :root #${selection.id}::before {
      content: "" !important;
      position: absolute !important;
      left: -2px !important;
      top: -2px !important;
      width: calc(100% + 4px) !important;
      height: calc(100% + 4px) !important;
      background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%25" height="100%25"><rect width="100%25" height="100%25" fill="none" stroke="black" stroke-width="4"/><rect width="100%25" height="100%25" fill="none" stroke="white" stroke-width="4" stroke-dasharray="2%25, 2%25" stroke-dashoffset="1%25"><animate attributeName="stroke-dashoffset" values="1%25;5%25" dur="5s" repeatCount="indefinite"/></rect></svg>') !important;
    }
    @media (prefers-reduced-motion) {
      :root #${selection.id}::before {
        background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100%25" height="100%25"><rect width="100%25" height="100%25" fill="none" stroke="black" stroke-width="4"/><rect width="100%25" height="100%25" fill="none" stroke="white" stroke-width="4" stroke-dasharray="2%25, 2%25" stroke-dashoffset="1%25"/></svg>') !important;
      }
    }
  `;

  let x1, y1, x2, y2, scrollX, scrollY, left, top, width, height;

  let clamp = (x, y) => {
    let {cw, ch} = GetPageInfo();
    // excluding scrollbar width/height
    return [Math.max(0, Math.min(x, cw)), Math.max(0, Math.min(y, ch))];
  };
  let nopop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  let onMouseMove = (event) => {
    nopop(event);
    // new positions
    [x2, y2] = clamp(event.clientX, event.clientY);
    scrollX = x1 < x2 ? scrollX : window.scrollX;
    scrollY = y1 < y2 ? scrollY : window.scrollY;
    // update relative positions
    left = (x1 < x2 ? x1 : x2);
    top = (y1 < y2 ? y1 : y2);
    width = Math.abs(x1 - x2);
    height = Math.abs(y1 - y2);
    // FIXME: circumvent "transform: translate(...) matrix(...)"
    selection.setAttribute('style', `
      top: ${top}px !important;
      left: ${left}px !important;
      width: ${width}px !important;
      height: ${height}px !important;
    `);
    selection.dataset.w = width;
    selection.dataset.h = height;
  };
  let onMouseDown = (event) => {
    nopop(event);
    // starting postions
    [x1, y1] = clamp(event.clientX, event.clientY);
    scrollX = window.scrollX;
    scrollY = window.scrollY;
    window.addEventListener('mousemove', onMouseMove, {capture: true});
  };
  window.addEventListener('mousedown', onMouseDown, {capture: true, once: true});

  return new Promise((resolve, reject) => {
    let onKeyup = (event) => {
      if (event.key === 'Escape' || event.keyCode === 27) {
        cleanup();
        reject();
      }
    };
    let cleanup = () => {
      window.removeEventListener('keyup', onKeyup, {capture: true});
      window.removeEventListener('mousemove', onMouseMove, {capture: true});
      overlay.remove();
    };
    window.addEventListener('keyup', onKeyup, {capture: true});
    // TODO: allow readjustment by dragging the corners
    window.addEventListener('mouseup', (event) => {
      nopop(event);
      cleanup();
      let i = GetPageInfo();
      resolve({
        left: i.dx > 0 ? scrollX + left : i.sw + scrollX - i.cw + left,
        top: i.dy > 0 ? scrollY + top : i.sh + scrollY - i.ch + top,
        width: width,
        height: height,
      });
    }, {capture: true, once: true});
  });
}


async function TakeScreenshot(request) {
  const prefs = await Storage.get();
  const format = request.format || prefs.formats[0];
  const region = request.region || prefs.regions[0];

  let i = GetPageInfo();

  if (region == 'full') {
    SaveScreenshot({
      region: region,
      left: 0,
      top: 0,
      // excluding scrollbar width/height
      width: i.sw,
      height: i.sh,
      format: format,
    });
  } else if (region == 'selection') {
    Select().then((area) => {
      SaveScreenshot({
        region: region,
        left: area.left,
        top: area.top,
        width: area.width,
        height: area.height,
        format: format,
      });
    });
  } else {
    SaveScreenshot({
      region: region,
      left: i.dx > 0 ? i.sx : i.sw + i.sx - i.cw,
      top: i.dy > 0 ? i.sy : i.sh + i.sy - i.ch,
      // excluding scrollbar width/height
      width: i.cw,
      height: i.ch,
      format: format,
    });
  }
}

function SaveScreenshot({region, left, top, width, height, format}) {
  let i = GetPageInfo();
  let [sx, sy] = [Math.trunc(i.sx), Math.trunc(i.sy)];
  let [spx, spy] = [i.sx - sx, i.sy - sy];
  browser.runtime.sendMessage({
    type: 'TakeScreenshot',
    format: format,
    region: region,
    // distance from top left corner (non-negative)
    left: Math.trunc(left),
    top: Math.trunc(top),
    // extent from top left to bottom right
    width: width,
    height: height,
    // view width/height (excluding scrollbar width/height)
    vw: i.cw,
    vh: i.ch,
    // page width/height (excluding scrollbar width/height)
    pw: i.sw,
    ph: i.sh,
    // scrollbar width/height, not included in i.sw or i.sh
    bw: i.bw,
    bh: i.bh,
    // direction of axis X/Y (Left2Right/Top2Bottom = 1; Right2Left/Bottom2Top = -1)
    direction: {x: i.dx, y: i.dy},
    // subpixel-precise decimal, negative when Right2Left or Bottom2Top
    scroll: {sx, sy, spx, spy},
    // https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
    scale: window.devicePixelRatio,
  });
}


// Triggers a download.
async function TriggerOpen(content, filename) {
  let url = URL.createObjectURL(content);
  let a = document.createElement('a');
  try {
    a.href = url;
    a.download = filename;
    a.hidden = true;
    a.style.display = 'none';
    a.style.position = 'fixed';
    a.style.top = '100vh';
    // necessary for Firefox 57
    (document.body || document.documentElement).appendChild(a);
    a.click();
  } finally {
    URL.revokeObjectURL(url);
    a.remove();
  }
}


// https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawWindow
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toDataURL
// https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/toBlob
async function DrawWindow(req) {
  let canvas = document.createElement('canvas');
  let ctx = canvas.getContext('2d', {alpha: false});
  let {format, quality, rect: {x, y, width, height}} = req;
  quality = (format === 'image/jpeg' ? quality / 100 : 1);
  canvas.width = Math.trunc(width);
  canvas.height = Math.trunc(height);
  ctx.imageSmoothingEnabled = true;
  ctx.drawWindow(window, x, y, width, height, 'rgba(255,0,255,1)');
  return canvas.toDataURL(format, quality);
  //// Security Error: Content at moz-extension://<uuid>/background.html may not
  //// load data from blob:https://example.com/<uuid>
  //return new Promise((resolve, reject) => {
  //  try {
  //    canvas.toBlob(blob => {
  //      if (blob) {
  //        resolve(URL.createObjectURL(blob));
  //      } else {
  //        reject();
  //      }
  //    }, format, quality);
  //  } catch (err) {
  //    reject(err);
  //  }
  //});
}


// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#communicating_with_background_scripts
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'TriggerOpen': return TriggerOpen(request.content, request.filename);
    case 'TakeScreenshot': return TakeScreenshot(request);
    case 'DrawWindow': return DrawWindow(request);
  }
  return false;
});
