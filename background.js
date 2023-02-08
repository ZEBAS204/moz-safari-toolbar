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

let DEBUG_DRAW = false;

const browserAction = browser.browserAction;

function DecodeImage$(url) {
  let img = new Image();
  if (img.decode) {
    img.src = url;
    return img.decode().then(() => Promise.resolve(img));
  }
  return new Promise((resolve, reject) => {
    let max_try = 1000;
    img.onload = () => {
      if (img.complete) resolve(img);
      else if (max_try-- > 0) setTimeout(img.onload, 0);
      else reject();
    };
    img.onerror = () => {
      reject();
    };
    img.src = url;
  });
}

// tested using about:config (layout.css.devPixelsPerPx=<ratio>)
function GetRealPixelRatio$({version, tab, width, height, scale}) {
  let task = null, param = {format: 'jpeg', quality: 0};
  if (version >= 59) {
    if (version >= 82) {
      // WTF: without this => real-ratio:3 crop-size:450x200 real-size:1350x603
      param.rect = {x: 0, y: 0, width, height};
    }
    task = browser.tabs.captureTab(tab.id, param);
  } else {
    task = browser.tabs.captureVisibleTab(tab.windowId, param);
  }
  return task
    .then(url => DecodeImage$(url))
    .then(img => {
      let [w, h] = [img.naturalWidth, img.naturalHeight];
      // WTF: based on screenshot function of the built-in Developer Tools
      if ([w, void(w - 1)].indexOf(Math.trunc(width * scale)) >= 0 &&
          [h, void(h - 1)].indexOf(Math.trunc(height * scale)) >= 0) {
        return scale;
      }
      let k = 2 ** Math.min(Math.ceil(Math.log2(Math.max(width, height))), 10);
      let scl_w = w * k / width;
      let scl_h = h * k / height;
      console.info({
        size: `${width}x${height}`,
        real: `${w}x${h}`,
        k, scl_w, scl_h
      });
      let scl = [
        Math.floor(scl_w) / k, scl_w / k, Math.ceil(scl_w) / k,
        Math.floor(scl_h) / k, scl_h / k, Math.ceil(scl_h) / k,
      ].sort().reverse().find(scl => {
        return Math.trunc(width * scl) === w && Math.trunc(height * scl) === h;
      });
      if (scl) {
        console.info({scl});
        return scl;
      }
      return scale;
    });
}

// Fired if one of our context menu entries is clicked.
function ContextMenuClicked(aInfo) {
  SendMessage(aInfo.menuItemId);
}

// Fired if toolbar button is clicked
function ToolbarButtonClicked() {
  SendMessage('{}');
}

// Fired if shortcut is pressed
function CommandPressed(name) {
  const info = name.split('-');
  SendMessage(JSON.stringify({region: info[0], format: info[1]}));
}

// Triggers UI update (toolbar button popup and context menu)
async function UpdateUI() {
  // Get menu list
  const menus = await GetMenuList();

  //
  // Update toolbar button popup
  //

  if (menus.length)
    await browserAction.setPopup({popup: "popup/choose_format.html"});
  else
    await browserAction.setPopup({popup: ""});

  //
  // Update context menu
  //

  await browser.contextMenus.removeAll();

  const prefs = await Storage.get();

  if (prefs.show_contextmenu) {
    const topmenu = browser.contextMenus.create({
      id: '{}',
      title: T$('extensionName'),
      contexts: ['page'],
    });

    menus.forEach((entry) => {
      browser.contextMenus.create({
        id: entry.data,
        title: entry.label,
        contexts: ["page"],
        parentId: topmenu
      });
    });
  }
}

// Register event listener to receive option update notifications and
// content script requests
browser.runtime.onMessage.addListener((data, sender) => {
  // An option change with request for redraw happened
  if (data.type === 'OptionsChanged' && data.redraw) return UpdateUI();

  // The content script requests us to take a screenshot
  if (data.type === 'TakeScreenshot') return TakeScreenshot(data, sender.tab);
});


async function TakeScreenshot(req, tab) {
  // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_support_for_JavaScript_APIs
  const BROWSER_VERSION_MAJOR = parseInt((await browser.runtime.getBrowserInfo()).version, 10);
  const badge = ['setTitle', 'setBadgeText', 'setBadgeBackgroundColor'].every(x => {
    return x in browserAction;
  });

  const mutex = new Mutex({lock_time: 1000 * 60 * 5});
  const key = 'browserAction-' + tab.id;
  const nid = Date.now();

  const format = {
    png: ['png', 'png', 'image/png'],
    jpg: ['jpg', 'jpeg', 'image/jpeg'],
    copy: ['png', 'png', 'image/png'],
  }[req.format];
  const prefs = await Storage.get();
  const quality = prefs.jpegquality;
  const filename = GetDefaultFileName('saved_page', tab, prefs.filenameformat) + '.' + format[0];

  let restoreScrollPosition = () => Promise.resolve();
  try {
    if (!(await mutex.lock(key, {retry: false}))) {
      return;
    }
    await browserAction.disable(tab.id);

    // Maximum size is limited!
    // https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
    // https://hg.mozilla.org/mozilla-central/file/93c7ed3f5606865707e5ebee8709b13ce0c2e220/dom/canvas/CanvasRenderingContext2D.cpp#l4814
    // https://hg.mozilla.org/mozilla-central/file/93c7ed3f5606865707e5ebee8709b13ce0c2e220/gfx/2d/Factory.cpp#l326
    // WTF: animation sucks your eyeballs out during multiple screen captures
    const {vw, vh, pw, ph, bw, bh, width: rw, height: rh} = req;
    const {scroll: {sx, sy, spx, spy}, direction: dir} = req;

    // tested using about:config (privacy.resistFingerprinting=[true|false])
    const scale = await GetRealPixelRatio$({
      version: BROWSER_VERSION_MAJOR,
      tab: tab,
      width: vw + bw,
      height: vh + bh,
      scale: req.scale,
    });

    const limits = [32767 / scale, 472907776 / (scale * scale)].map(Math.trunc);
    const one_canvas = Math.max(rw, rh) <= limits[0] && rw * rh <= limits[1];

    const [totalWidth, totalHeight] = [rw, rh].map(x => Math.trunc(x * scale));
    let content = null;
    if (one_canvas) {
      let canvas = document.createElement('canvas');
      content = canvas.getContext('2d', {alpha: true});
      canvas.width = totalWidth;
      canvas.height = totalHeight;
      content.imageSmoothingEnabled = false; //! Final image will be blurred
      content.filter = 'blur(10px)'; //! Final image will be blurred
    } else {
      // TODO: new ImageWriter('avif'); // grid/overlay derivation
      // TODO: new ImageWriter('tiff'); URL.createObjectURL(new Blob([...tiff_strips]))
      try {
        let size = totalWidth * totalHeight * 4;
        if (size < Number.MAX_SAFE_INTEGER) {
          switch (format[1]) {
            case 'png':  // seriously?
              if (totalWidth > 2147483647 || totalHeight > 2147483647) throw null;
              break;
            case 'jpeg':
              if (totalWidth > 65535 || totalHeight > 65535) throw null;
              break;
          }
          // RangeError: invalid array length ?
          content = new Uint8Array(size);
        } else {
          throw null;
        }
      } catch (err) {
        alarm(T$('errorImageTooLarge', filename), {id: nid});
        return;
      }
      notify(T$('warningImageVeryLarge'), {id: nid});
    }

    const use_native = (BROWSER_VERSION_MAJOR >= 82
                        || (scale === 1 && CanvasRenderingContext2D.prototype.drawWindow));
    const use_css_croll = !use_native;
    const use_js_scroll = !use_native && !use_css_croll;
    const wtf_scrollbar = !use_native && !(bw || bh);

    console.info({
      BROWSER_VERSION_MAJOR, req, scale, one_canvas,
      use_native, use_css_croll, use_js_scroll, wtf_scrollbar,
    });

    // XXX: scrolling can cause side effects
    let use_scroll = use_css_croll || use_js_scroll;
    let updateScrollPosition = null;

    // WTF: smooth scrolling is time consuming (solved by behavior:auto)
    const js_scroll_restore = `window.scrollTo({left: ${sx + spx}, top: ${sy + spy}, behavior: 'auto'})`;
    const css_reset_1 = {
      allFrames: false,
      runAt: 'document_start',
      cssOrigin: 'user',
      code: [
        ':root { scroll-behavior: auto !important; }',
        `:root { min-width: ${vw}px !important; }`,
        `:root { min-height: ${vh}px !important; }`,
        // Firefox 64+ : scrollbar-color scrollbar-width
        (!wtf_scrollbar ? '' : ':root { scrollbar-color: transparent transparent !important; }'),
        // XXX: scrollbar still reappears in scrollable child element
        //      for around one second after each scroll
        (!wtf_scrollbar ? '' : ':root { scrollbar-width: none !important; }'),
      ].join('\n'),
    };
    const css_reset_2 = {
      allFrames: true,
      runAt: 'document_start',
      cssOrigin: 'user',
      code: [
        '*, *>*, *>*>*',
        ', *::before, *>*::before, *>*>*::before',
        ', *::after, *>*::after, *>*>*::after',
        '{ animation-play-state: paused !important; }',
      ].join('\n'),
    };

    let undoJSScroll = () => {
      return browser.tabs.executeScript(tab.id, {
        allFrames: false,
        runAt: 'document_start',
        code: js_scroll_restore,
      });
    };
    let doCSSReset = () => {
      return browser.tabs.insertCSS(tab.id, css_reset_1).then(() => {
        return browser.tabs.insertCSS(tab.id, css_reset_2);
      });
    };
    let undoCSSReset = () => {
      return browser.tabs.removeCSS(tab.id, css_reset_2).then(() => {
        return browser.tabs.removeCSS(tab.id, css_reset_1);
      });
    };

    let resetScrollPosition = () => {
      // TODO: pause js and svg animation, pause animated graphics and videos
      return doCSSReset().then(() => {
        // reset position of sticky elements
        return browser.tabs.executeScript(tab.id, {
          allFrames: false,
          runAt: 'document_start',
          code: 'window.scrollTo({top: 0, left: 0, behavior: "auto"})',
        });
      });
    };

    if (use_css_croll) {
      let tasks = [undoCSSReset];
      restoreScrollPosition = () => {
        restoreScrollPosition = () => Promise.resolve();
        return Promise.all(tasks.map(exec => exec())).then(undoJSScroll);
      };
      // https://developer.mozilla.org/en-US/docs/Web/CSS/Cascade
      let applyCssScroll = null;
      // NOTE: stuttering of background when scrollbar disappear?
      //       solution is :root { min-[width|height]: actual page size }
      let style = (await browser.tabs.executeScript(tab.id, {
        allFrames: false,
        runAt: 'document_start',
        code: `{
          let style = window.getComputedStyle(document.documentElement);
          ({
            translate: style.translate,
            transform: style.transform,
            bgx: style.backgroundPositionX,
            bgy: style.backgroundPositionY,
          })
        }`,
      }))[0];
      style.bgx = style.bgx.split(/\s*,\s*/);
      style.bgy = style.bgy.split(/\s*,\s*/);
      if (style.translate != null) {
        let xyz = (style.translate.replace(/^none$/, '') + ' 0px 0px 0px').trim().split(/\s+/);
        applyCssScroll = (x, y) => {
          let bgx = style.bgx.map(v => `calc(${v} - ${x}px)`).join(', ');
          let bgy = style.bgy.map(v => `calc(${v} - ${y}px)`).join(', ');
          let css = {
            runAt: 'document_start',
            cssOrigin: 'user',
            code: `
              :root {
                translate: calc(${xyz[0]} - ${x}px) calc(${xyz[1]} - ${y}px)
                           ${xyz[2]} !important;
                transition: none !important;
                background-position-x: ${bgx} !important;
                background-position-y: ${bgy} !important;
              }
            `,
          };
          return browser.tabs.insertCSS(tab.id, css).then(() => {
            tasks.push(() => browser.tabs.removeCSS(tab.id, css));
          });
        };
      } else {
        let toCSS = (x, y) => {
          if (/\bmatrix(?:3d)?\b/.test(style.transform)) {
            return style.transform.replace(
              /\b(matrix(?:3d)?)\s*\(([^)]*)\)/,
              (_, func, args) => {
                let xyz = args.split(/\s*,\s*/);
                switch (func) {
                  case 'matrix':
                    xyz[4] = `calc(${xyz[4]} - ${x}px)`;
                    xyz[5] = `calc(${xyz[5]} - ${y}px)`;
                    break;
                  case 'matrix3d':
                    xyz[12] = `calc(${xyz[12]} - ${x}px)`;
                    xyz[13] = `calc(${xyz[13]} - ${y}px)`;
                    break;
                  default: throw new Error('toCSS');
                }
                return `${func}(${xyz.join(', ')})`;
              }
            );
          } else {
            return style.transform.replace(/^none$/, '') + ` translate(-${x}px, -${y}px)`;
          }
        };
        applyCssScroll = (x, y) => {
          let bgx = style.bgx.map(v => `calc(${v} - ${x}px)`).join(', ');
          let bgy = style.bgy.map(v => `calc(${v} - ${y}px)`).join(', ');
          let css = {
            runAt: 'document_start',
            cssOrigin: 'user',
            code: `
              :root {
                transform: ${toCSS(x, y)} !important;
                transition: none !important;
                background-position-x: ${bgx} !important;
                background-position-y: ${bgy} !important;
              }
            `,
          };
          return browser.tabs.insertCSS(tab.id, css).then(() => {
            tasks.push(() => browser.tabs.removeCSS(tab.id, css));
          });
        };
      }
      let is_first = true;  // (sx, sy) is static, useless after scrolling
      updateScrollPosition = async ({x, y, w, h}) => {
        // _s[xy] is not clamped when exceeding scrollMax[XY]
        let _sx = dir.x > 0 ? x : -(pw - x) + w;
        let _sy = dir.y > 0 ? y : -(ph - y) + h;
        if (is_first) {
          is_first = false;
          let no_scroll_x = dir.x > 0 ? (_sx >= sx && _sx + w <= sx + vw)
                                      : (_sx <= sx && _sx - w >= sx - vw);
          let no_scroll_y = dir.y > 0 ? (_sy >= sy && _sy + h <= sy + vh)
                                      : (_sy <= sy && _sy - h >= sy - vh);
          if (no_scroll_x && no_scroll_y) {
            return {
              x: dir.x > 0 ? _sx - sx : vw - (sx - _sx + w),
              y: dir.y > 0 ? _sy - sy : vh - (sy - _sy + h),
            };
          }
        }
        await applyCssScroll(_sx, _sy);
        return {
          x: dir.x > 0 ? 0 : vw - w,
          y: dir.y > 0 ? 0 : vh - h,
        };
      };
    } else if (use_js_scroll) {
      restoreScrollPosition = () => {
        restoreScrollPosition = () => Promise.resolve();
        return undoCSSReset().then(undoJSScroll);
      };
      let is_first = true;  // (sx, sy) is static, useless after scrolling
      updateScrollPosition = async ({x, y, w, h}) => {
        // _s[xy] is not clamped when exceeding scrollMax[XY]
        let _sx = dir.x > 0 ? x : -(pw - x) + w;
        let _sy = dir.y > 0 ? y : -(ph - y) + h;
        if (is_first) {
          is_first = false;
          let no_scroll_x = dir.x > 0 ? (_sx >= sx && _sx + w <= sx + vw)
                                      : (_sx <= sx && _sx - w >= sx - vw);
          let no_scroll_y = dir.y > 0 ? (_sy >= sy && _sy + h <= sy + vh)
                                      : (_sy <= sy && _sy - h >= sy - vh);
          if (no_scroll_x && no_scroll_y) {
            return {
              x: dir.x > 0 ? _sx - sx : vw - (sx - _sx + w),
              y: dir.y > 0 ? _sy - sy : vh - (sy - _sy + h),
            };
          }
        }
        await browser.tabs.executeScript(tab.id, {
          allFrames: false,
          runAt: 'document_start',
          code: `window.scrollTo({left: ${_sx}, top: ${_sy}, behavior: 'auto'})`,
        });
        return {
          // full page ?
          x: x <= pw - vw ? 0 : vw - w,
          y: y <= ph - vh ? 0 : vh - h,
        };
      };
    }

    if (req.region === 'full') {
      if (!use_scroll && use_native) {
        use_scroll = true;
        restoreScrollPosition = () => {
          restoreScrollPosition = () => Promise.resolve();
          return undoCSSReset().then(undoJSScroll);
        };
      }
      await resetScrollPosition();
    }

    const [mw, mh] = (() => {
      // WTF: browser.tab.captureTab and DrawWindow:
      //      glitches happen on large capture area
      //      happens when scale != window.devicePixelRatio ?
      //      test page: https://en.wikipedia.org/wiki/Firefox
      if (use_native) {
        if (false && BROWSER_VERSION_MAJOR >= 82 && scale === window.devicePixelRatio) {
          return [rw, rh].map(x => Math.min(x, limits[0]));
        } else {
          return [Math.min(rw, limits[0], 4095), Math.min(rh, limits[0], 16383)];
        }
      } else {
        return [Math.min(vw, limits[0], 4095), Math.min(vh, limits[0], 16383)];
      }
    })();

    if (badge) {
      await browserAction.setTitle({title: T$('badge_capturing'), tabId: tab.id});
      await browserAction.setBadgeBackgroundColor({color: 'red', tabId: tab.id});
    }
    const jobs = new JobQueue();
    const decoding = new JobQueue();
    let count = Math.ceil(rw / mw) * Math.ceil(rh / mh);
    let debug_n = 0;

    for (let y = 0; y < rh; y += mh) {
      let h = (y + mh <= rh ? mh : rh - y);
      for (let x = 0; x < rw; x += mw) {
        let w = (x + mw <= rw ? mw : rw - x);
        let left = req.left + x;
        let top = req.top + y;
        if (badge) {
          jobs.push(() => {
            // no waiting since capturing is in serial order; unimportant text
            browserAction.setBadgeText({text: String(count--), tabId: tab.id});
          });
        }
        let pos = null;
        if (use_native) {
          let _sx = dir.x > 0 ? left : Math.min(-(pw - left) + vw, vw - w);
          let _sy = dir.y > 0 ? top : Math.min(-(ph - top) + vh, vh - h);
          pos = {x: 0, y: 0};
          if (BROWSER_VERSION_MAJOR >= 82) {
            let opts = {
              format: format[1],
              quality: one_canvas ? quality : 100,
              rect: {x: _sx, y: _sy, width: w, height: h},
              scale: scale,
            };
            jobs.push(() => browser.tabs.captureTab(tab.id, opts));
          } else {
            // doesn't seem to support high dpi
            let opts = {
              type: 'DrawWindow',
              format: format[2],
              quality: one_canvas ? quality : 100,
              rect: {x: _sx, y: _sy, width: w, height: h},
            };
            jobs.push(() => browser.tabs.sendMessage(tab.id, opts));
          }
        } else {
          let rect = {x: left, y: top, w, h};
          jobs.push(async () => pos = await updateScrollPosition(rect));
          if (false && BROWSER_VERSION_MAJOR >= 82) {
            jobs.push(() => browser.tabs.captureTab(tab.id, {
              format: format[1],
              quality: 100,
              // a fix for only when manually testing on newer browsers
              scale: scale,
            }));
          } else if (BROWSER_VERSION_MAJOR >= 59) {
            jobs.push(() => browser.tabs.captureTab(tab.id, {
              format: format[1],
              quality: one_canvas ? quality : 100,
            }));
          } else {
            jobs.push(() => browser.tabs.captureVisibleTab(tab.windowId, {
              format: format[1],
              quality: one_canvas ? quality : 100,
            }));
          }
        }
        let rect = {x, y, w, h};
        jobs.push(url => {
          let n = ++debug_n;
          decoding.push(() => {
            return DecodeImage$(url).then(img => {
              let {x, y, w, h} = rect;
              let scl_w = use_native ? scale : img.naturalWidth / (vw + bw);
              let scl_h = use_native ? scale : img.naturalHeight / (vh + bh);
              if (one_canvas) {
                content.drawImage(img, pos.x * scl_w, pos.y * scl_h, w * scl_w, h * scl_h,
                                           x * scale,     y * scale, w * scale, h * scale);
                DebugDraw(content, {x, y, w, h, scale, n});
              } else {
                let canvas = document.createElement('canvas');
                let ctx = canvas.getContext('2d', {alpha: true});
                canvas.width = Math.trunc(w * scale);
                canvas.height = Math.trunc(h * scale);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, pos.x * scl_w, pos.y * scl_h, w * scl_w, h * scl_h,
                                               0,             0, w * scale, h * scale);
                DebugDraw(ctx, {x:0, y:0, w, h, scale, n});
                if (x === 0 && w === rw) {
                  content.set(ctx.getImageData(0, 0, w * scale, h * scale).data,
                              y * rw * scale * 4);
                } else {
                  for (let i = 0; i < h * scale; i++) {
                    content.set(ctx.getImageData(0, i, w * scale, 1).data,
                                ((y + i) * rw * scale + x) * 4);
                  }
                }
              }
            });
          });
        });
      }
    }
    await jobs.serial().then(restoreScrollPosition);

    if (badge) {
      await browserAction.setTitle({title: T$('badge_saving'), tabId: tab.id});
      await browserAction.setBadgeText({text: '...', tabId: tab.id});
      await browserAction.setBadgeBackgroundColor({color: 'green', tabId: tab.id});
    }
    await browserAction.enable(tab.id);
    mutex.unlock(key);

    await decoding.parallel();
    if (one_canvas) {
      //console.log("BASE64 IMG:\n", content.canvas.toDataURL("image/jpeg"));
      applyTheme(tab.windowId, content.canvas.toDataURL("image/png"))
      //* -----------------------------------------------------------------------------------------------------
      //* -----------------------------------------------------------------------------------------------------
      content = await (await fetch(content.canvas.toDataURL())).arrayBuffer();
    } else {
      const lock_time = 1000 * 60 * 15;
      // worker is often cpu hog, just one is enough
      if (!(await mutex.lock('worker', {retry: false, lock_time}))) {
        notify(T$('warningWorkerBusy'), {id: nid});
        await mutex.lock('worker', {lock_time});
        if (badge) {
          await browserAction.setTitle({title: T$('badge_saving'), tabId: tab.id});
          await browserAction.setBadgeText({text: '...', tabId: tab.id});
          await browserAction.setBadgeBackgroundColor({color: 'green', tabId: tab.id});
        }
      }
//console.time('worker');
      // TODO: optional wasm support
      let worker = new Worker(
        format[1] === 'jpeg' ? 'lib/worker-jpeg.js' : 'lib/worker-png.js'
      );
      // use worker to avoid blocking other extensions
      content = await new Promise((resolve, reject) => {
        worker.onerror = (event) => reject(event);
        worker.onmessage = (event) => resolve(event.data);
        worker.postMessage({
          data: content,
          width: totalWidth,
          height: totalHeight,
          quality: quality,
        });
        setTimeout(reject, lock_time, 'timeout');
      }).catch(err => {
        abort(err);
      }).finally(() => {
        worker.terminate();
        mutex.unlock('worker');
      });
//console.timeEnd('worker');
    }

    // Handle copy to clipboard
    if (req.format === 'copy') {
      /*
      ! Instead of copying the image, open a new window and
      ! place the image to debug
      await browser.clipboard.setImageData(content, format[1]);
      if (prefs.copynotification) {
        notify(T$('info_screenshot_copied'), {id: nid});
      }
      */
      await browser.tabs.sendMessage(tab.id, {
        type: 'TriggerOpen',
        content: new Blob([content], {type: format[2]}),
        filename: 'about:blank',
      });
  }

    // All other data formats have to be handled as downloads
    else {
      // Add image comment if we are allowed to
      if (prefs.image_comment) {
        content = await ApplyImageComment(content, tab.title, tab.url);
      }

      // The method "open" requires a temporary <a> hyperlink whose creation and
      // handling has to be offloaded to our content script
      if (prefs.savemethod === 'open') {
        await browser.tabs.sendMessage(tab.id, {
          type: 'TriggerOpen',
          content: new Blob([content], {type: format[2]}),
          filename: filename,
        });
      }
      // All other download types are handled with the "browser.downloads" API
      else {
        let url = URL.createObjectURL(new Blob([content], {type: format[2]}));
        let options = {
          filename: prefs.targetdir ? prefs.targetdir + '/' + filename : filename,
          url: url,
          saveAs: (prefs.savemethod === 'saveas')
        };

        const downloads = new Map();
        downloads.promise = new Promise((resolve, reject) => {
          downloads.resolve = resolve;
          downloads.reject = reject;
        });
        const OnDownload$ = (delta) => {
          if (delta.state && downloads.has(delta.id)) {
            if (delta.state.current === 'complete') {
              URL.revokeObjectURL(downloads.get(delta.id).url);
              downloads.delete(delta.id);
              if (downloads.size === 0) {
                downloads.resolve();
              }
            } else if (delta.state.current === 'interrupted') {
              URL.revokeObjectURL(downloads.get(delta.id).url);
              downloads.reject();
            }
          }
        };
        // Download change listener.
        // Used to create a notification in the "non prompting" mode, so the user knows
        // that his screenshot has been created. Also handles cleanup after download.
        browser.downloads.onChanged.addListener(OnDownload$);

        try {
          // Trigger download
          let download_id = await browser.downloads.download(options);

          // Store download options for usage in "onChanged".
          downloads.set(download_id, options);
          await downloads.promise;

          // When saving without prompting, then trigger notification
          const prefs = await Storage.get();
          if (!options.saveAs && prefs.savenotification) {
            notify(T$('info_screenshot_saved') + '\n' + filename, {id: nid});
          }
        } catch (err) {
          abort(err);
        } finally {
          // Free memory used for our "blob URL"
          URL.revokeObjectURL(options.url);
          browser.downloads.onChanged.removeListener(OnDownload$);
        }
      }
    }
  } catch (err) {
    console.error(err);
    alarm(`Failed to generate ${filename}\nReason: ${err}`, {id: nid});
    restoreScrollPosition().catch(ignore);
  } finally {
    if (await mutex.lock(key, {retry: false})) {
      if (badge) {
        await browserAction.setTitle({title: '', tabId: tab.id});
        await browserAction.setBadgeText({text: '', tabId: tab.id});
        try {
          await browserAction.setBadgeBackgroundColor({color: null, tabId: tab.id});
        } catch (err) {
          await browserAction.setBadgeBackgroundColor({color: '', tabId: tab.id});
        }
      }
      await browserAction.enable(tab.id);
      mutex.unlock(key);
    }
    mutex.unlock('worker');
  }
}
function DebugDraw(ctx, info) {
  if (!DEBUG_DRAW) return;
  ctx.save();
  ctx.scale(info.scale, info.scale);
  ctx.fillStyle = ['rgba(255,0,0,0.1)', 'rgba(0,255,0,0.1)', 'rgba(0,0,255,0.1)'][info.n % 3];
  ctx.font = `${50 * info.scale}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.strokeStyle = '#000';
  ctx.setLineDash([5, 5]);
  ctx.lineWidth = 1;
  ctx.fillRect(info.x, info.y, info.w, info.h);
  ctx.strokeRect(info.x, info.y, info.w, info.h);
  ctx.setLineDash([]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#fff';
  ctx.strokeText(info.n, info.x, info.y, info.w);
  ctx.fillStyle = '#000';
  ctx.fillText(info.n, info.x, info.y, info.w);
  ctx.restore();
}


// Gets the default file name, used for saving the screenshot
function GetDefaultFileName(aDefaultFileName, tab, aFilenameFormat) {
  //prioritize formatted variant
  const formatted = SanitizeFileName(ApplyFilenameFormat(aFilenameFormat, tab));
  if (formatted)
    return formatted;

  // If possible, base the file name on document title
  const title = SanitizeFileName(tab.title);
  if (title)
    return title;

  // Otherwise try to use the actual HTML filename
  const url = new URL(tab.url)
  const path = url.pathname;
  if (path) {
    const filename = SanitizeFileName(path.substring(path.lastIndexOf('/')+1));
    if (filename)
      return filename;
  }

  // Finally use the provided default name
  return aDefaultFileName;
}

// Replaces format character sequences with the actual values
function ApplyFilenameFormat(aFormat, tab) {
  const now = new Date();
  return aFormat.replace(/%[\s\S]?/g, (s) => {
    switch (s) {
      case '%Y': return now.getFullYear();
      case '%m': return String(now.getMonth() + 1).padStart(2, '0');
      case '%d': return String(now.getDate()).padStart(2, '0');
      case '%H': return String(now.getHours()).padStart(2, '0');
      case '%M': return String(now.getMinutes()).padStart(2, '0');
      case '%S': return String(now.getSeconds()).padStart(2, '0');
      case '%t': return tab.title || '';
      case '%u': return tab.url.replace(/:/g, '.').replace(/[/?]/g, '-');
      case '%h': return new URL(tab.url).host.replace(/\.$/, '') || 'NULL';
      //case '%%': return '%';
      default: return s;
    }
  });
}

// "Sanitizes" given string to be used as file name.
function SanitizeFileName(aFileName) {
  // http://www.mtu.edu/umc/services/digital/writing/characters-avoid/
  aFileName = aFileName.replace(/[<\{]+/g, "(");
  aFileName = aFileName.replace(/[>\}]+/g, ")");
  aFileName = aFileName.replace(/[#$%!&*\'?\"\/:\\@|]/g, "");
  // Remove leading spaces, "." and "-"
  aFileName = aFileName.replace(/^[-.\s]+/, "");
  // Remove trailing spaces and "."
  aFileName = aFileName.replace(/[\s.]+$/, "");
  // Replace all groups of spaces with just one space character
  aFileName = aFileName.replace(/\s+/g, " ");
  return aFileName;
}


// Migrates old "only one possible" preferences to new "multi select" model
async function MigrateSettings() {
  const prefs = await Storage.get();
  const newprefs = {};
  if ("region" in prefs) {
    if (prefs.region == "manual")
      newprefs.regions = ["full", "viewport", "selection"];
    else
      newprefs.regions = [prefs.region];
    await Storage.remove("region");
  }
  if ("format" in prefs) {
    if (prefs.format == "manual")
      newprefs.formats = ["png", "jpg", "copy"];
    else
      newprefs.formats = [prefs.format];
    await Storage.remove("format");
  }
  await Storage.set(newprefs);
}
const buffer = []
function applyTheme(tabID, base64Url) {
  buffer.push(base64Url) // Push as last element
  if (buffer.length === 3) {
    buffer.shift() // Pop first element
  }
  const theme = {
    images: {
      additional_backgrounds: [...buffer],
    },
    properties: {
      additional_backgrounds_alignment: Array(buffer.length).fill("center top"),
      // additional_backgrounds_tiling: Array(buffer.length).fill("no-repeat"), Already the default value
      color_scheme: 'auto', // TODO: grab the color scheme of the theme?
    }
  }
  browser.theme.update(tabID, theme);
}

async function Startup() {
  await MigrateSettings();
  await UpdateUI();
}

// Register event listeners
browser.contextMenus.onClicked.addListener(ContextMenuClicked);
browser.browserAction.onClicked.addListener(ToolbarButtonClicked);
browser.commands.onCommand.addListener(CommandPressed);

Startup();
