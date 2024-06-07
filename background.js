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

;('use strict')

/**
 * WebAssembly blur lib service worker
 */
const worker = new Worker('/lib/worker-wasm.js') // know error, remove worker integration
console.log('Is worker supported?', 'serviceWorker' in navigator)
//! console.log('Is wasm lib loaded?', lib)

// Use worker to avoid blocking other extensions
worker.onerror = (event) => {
	// console.error('Worker error', event)
	worker.terminate()
}

worker.onmessageerror = (event) => {
	console.error(`Error receiving message from worker:`, event)
	worker.terminate()
}

worker.onmessage = (event) => {
	const message = event.data
	if (message.type === 'error') {
		console.error('Worker error message:', message.message)
		console.error('Worker error stack:', message.stack)
	} else {
		console.log('Worker message', message)
		content = message
	}
	//worker.terminate()
}

// TODO: rename blur radius and make it configurable
let DEBUG_DRAW = false
const TODO_BLUR_RADIUS = 10

const browserAction = browser.browserAction

function DecodeImage$(url) {
	const img = new Image()
	if (img.decode) {
		img.src = url
		return img.decode().then(() => Promise.resolve(img))
	}
	return new Promise((resolve, reject) => {
		let max_try = 1000
		img.onload = () => {
			if (img.complete) resolve(img)
			else if (max_try-- > 0) setTimeout(img.onload, 0)
			else reject()
		}
		img.onerror = () => {
			reject()
		}
		img.src = url
	})
}

// tested using about:config (layout.css.devPixelsPerPx=<ratio>)
function GetRealPixelRatio$({ version, tab, width, height, scale }) {
	let task = null,
		param = { format: 'jpeg', quality: 0 }
	if (version >= 59) {
		if (version >= 82) {
			// WTF: without this => real-ratio:3 crop-size:450x200 real-size:1350x603
			param.rect = { x: 0, y: 0, width, height }
		}
		task = browser.tabs.captureTab(tab.id, param)
	} else {
		task = browser.tabs.captureVisibleTab(tab.windowId, param)
	}
	return task
		.then((url) => DecodeImage$(url))
		.then((img) => {
			let [w, h] = [img.naturalWidth, img.naturalHeight]
			// WTF: based on screenshot function of the built-in Developer Tools
			if (
				[w, void (w - 1)].indexOf(Math.trunc(width * scale)) >= 0 &&
				[h, void (h - 1)].indexOf(Math.trunc(height * scale)) >= 0
			) {
				return scale
			}
			let k = 2 ** Math.min(Math.ceil(Math.log2(Math.max(width, height))), 10)
			let scl_w = (w * k) / width
			let scl_h = (h * k) / height
			console.info({
				size: `${width}x${height}`,
				real: `${w}x${h}`,
				k,
				scl_w,
				scl_h,
			})
			let scl = [
				Math.floor(scl_w) / k,
				scl_w / k,
				Math.ceil(scl_w) / k,
				Math.floor(scl_h) / k,
				scl_h / k,
				Math.ceil(scl_h) / k,
			]
				.sort()
				.reverse()
				.find((scl) => {
					return Math.trunc(width * scl) === w && Math.trunc(height * scl) === h
				})
			if (scl) {
				console.info({ scl })
				return scl
			}
			console.log('GetRealPixelRatio():', scale)
			return scale
		})
}

// Fired if one of our context menu entries is clicked.
function ContextMenuClicked(aInfo) {
	SendMessage(aInfo.menuItemId)
}

// Fired if toolbar button is clicked
function ToolbarButtonClicked() {
	SendMessage('{}')
}

// Fired if shortcut is pressed
function CommandPressed(name) {
	const info = name.split('-')
	SendMessage(JSON.stringify({ region: info[0], format: info[1] }))
}

// Triggers UI update (toolbar button popup and context menu)
async function UpdateUI() {
	// Get menu list
	const menus = await GetMenuList()

	//
	// Update toolbar button popup
	//
	if (menus.length)
		await browserAction.setPopup({ popup: 'popup/choose_format.html' })
	else await browserAction.setPopup({ popup: '' })

	//
	// Update context menu
	//
	await browser.contextMenus.removeAll()

	const prefs = await Storage.get()

	if (prefs.show_contextmenu) {
		const topmenu = browser.contextMenus.create({
			id: '{}',
			title: T$('extensionName'),
			contexts: ['page'],
		})

		menus.forEach((entry) => {
			browser.contextMenus.create({
				id: entry.data,
				title: entry.label,
				contexts: ['page'],
				parentId: topmenu,
			})
		})
	}
}

// Register event listener to receive option update notifications and
// content script requests
//* browser.tabs.onActivated.addListener(update); // When switch tabs
browser.runtime.onMessage.addListener((data, sender) => {
	// An option change with request for redraw happened
	if (data.type === 'OptionsChanged' && data.redraw) return UpdateUI()

	if (data.type === 'PruneCache') return PruneCache()

	// The content script requests us to take a screenshot
	if (data.type === 'TakeScreenshot') return TakeScreenshot(data, sender.tab)
})

let CANVAS_ELEMENT = null
async function TakeScreenshot(req, tab) {
	// https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Browser_support_for_JavaScript_APIs
	const BROWSER_VERSION_MAJOR = parseInt(
		(await browser.runtime.getBrowserInfo()).version,
		10
	)
	const badge = ['setTitle', 'setBadgeText', 'setBadgeBackgroundColor'].every(
		(x) => {
			return x in browserAction
		}
	)

	const mutex = new Mutex({ lock_time: 1000 * 60 * 5 })
	const key = 'browserAction-' + tab.id
	const nid = Date.now()

	const format = {
		png: ['png', 'png', 'image/png'],
		jpg: ['jpg', 'jpeg', 'image/jpeg'],
		copy: ['png', 'png', 'image/png'],
	}[req.format]
	const prefs = await Storage.get()
	const quality = prefs.jpegquality

	let restoreScrollPosition = () => Promise.resolve()
	try {
		if (!(await mutex.lock(key, { retry: false }))) {
			return
		}
		await browserAction.disable(tab.id)

		// Maximum size is limited!
		// https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
		// https://hg.mozilla.org/mozilla-central/file/93c7ed3f5606865707e5ebee8709b13ce0c2e220/dom/canvas/CanvasRenderingContext2D.cpp#l4814
		// https://hg.mozilla.org/mozilla-central/file/93c7ed3f5606865707e5ebee8709b13ce0c2e220/gfx/2d/Factory.cpp#l326
		// WTF: animation sucks your eyeballs out during multiple screen captures
		const { vw, vh, pw, ph, bw, bh, width: rw, height: rh } = req
		const { direction: dir } = req

		// tested using about:config (privacy.resistFingerprinting=[true|false])
		const scale = await GetRealPixelRatio$({
			version: BROWSER_VERSION_MAJOR,
			tab: tab,
			width: vw + bw,
			height: vh + bh,
			scale: req.scale,
		})

		const limits = [32767 / scale, 472907776 / (scale * scale)].map(Math.trunc)
		const one_canvas = Math.max(rw, rh) <= limits[0] && rw * rh <= limits[1]

		const [totalWidth, totalHeight] = [rw, rh].map((x) => Math.trunc(x * scale))
		let content = null
		let canvas = null
		if (CANVAS_ELEMENT && CANVAS_ELEMENT instanceof HTMLCanvasElement) {
			canvas = CANVAS_ELEMENT
		} else {
			console.log('Creating new drawing canvas')
			canvas = document.createElement('canvas')
			canvas.id = 'firefox-canvas-screenshot' // TODO: add random id
			CANVAS_ELEMENT = canvas
		}
		content = canvas.getContext('2d', {
			alpha: false,
			willReadFrequently: true,
		})
		canvas.width = totalWidth + bw
		canvas.height = totalHeight + bh
		content.imageSmoothingEnabled = false //! Final image will be blurred

		const use_native =
			BROWSER_VERSION_MAJOR >= 82 ||
			(scale === 1 && CanvasRenderingContext2D.prototype.drawWindow)

		console.info({
			BROWSER_VERSION_MAJOR,
			req,
			scale,
			one_canvas,
			use_native,
		})

		const [mw, mh] = (() => {
			// WTF: browser.tab.captureTab and DrawWindow:
			//      glitches happen on large capture area
			//      happens when scale != window.devicePixelRatio ?
			//      test page: https://en.wikipedia.org/wiki/Firefox
			if (use_native) {
				if (
					false &&
					BROWSER_VERSION_MAJOR >= 82 &&
					scale === window.devicePixelRatio
				) {
					return [rw, rh].map((x) => Math.min(x, limits[0]))
				} else {
					return [Math.min(rw, limits[0], 4095), Math.min(rh, limits[0], 16383)]
				}
			} else {
				return [Math.min(vw, limits[0], 4095), Math.min(vh, limits[0], 16383)]
			}
		})()

		if (badge) {
			await browserAction.setTitle({
				title: T$('badge_capturing'),
				tabId: tab.id,
			})
			await browserAction.setBadgeBackgroundColor({
				color: 'red',
				tabId: tab.id,
			})
		}
		const jobs = new JobQueue()
		const decoding = new JobQueue()
		let count = Math.ceil(rw / mw) * Math.ceil(rh / mh)
		let debug_n = 0

		for (let y = 0; y < rh; y += mh) {
			let h = y + mh <= rh ? mh : rh - y
			for (let x = 0; x < rw; x += mw) {
				let w = x + mw <= rw ? mw : rw - x
				let left = req.left + x
				let top = req.top + y
				if (badge) {
					jobs.push(() => {
						// no waiting since capturing is in serial order; unimportant text
						browserAction.setBadgeText({ text: String(count--), tabId: tab.id })
					})
				}
				const _sx = dir.x > 0 ? left : Math.min(-(pw - left) + vw, vw - w)
				const _sy = dir.y > 0 ? top : Math.min(-(ph - top) + vh, vh - h)
				const pos = { x: 0, y: 0 }

				if (BROWSER_VERSION_MAJOR >= 82) {
					const opts = {
						format: format[1],
						quality: one_canvas ? quality : 100,
						rect: { x: _sx, y: _sy, width: w, height: h },
						scale: scale,
					}
					jobs.push(() => browser.tabs.captureTab(tab.id, opts))
				} else {
					// doesn't seem to support high dpi
					const opts = {
						type: 'DrawWindow',
						format: format[2],
						quality: one_canvas ? quality : 100,
						rect: { x: _sx, y: _sy, width: w, height: h },
					}
					jobs.push(() => browser.tabs.sendMessage(tab.id, opts))
				}

				let rect = { x, y, w, h }
				console.time('decoding')
				jobs.push((url) => {
					//* console.log('Decoding url:', url)
					let n = ++debug_n
					return decoding.push(() => {
						//console.log('Worker?', worker)
						/*worker.postMessage({
							data: url,
							blurRadius: TODO_BLUR_RADIUS,
						})
						*/
						const blurredBg = lib(url, TODO_BLUR_RADIUS)
						// console.log('Blurred:\n', blurredBg)
						content = blurredBg
						return
					})

					/*
					decoding.push(() => {
						return DecodeImage$(url).then((img) => {
							let { x, y, w, h } = rect
							let scl_w = use_native ? scale : img.naturalWidth / (vw + bw)
							let scl_h = use_native ? scale : img.naturalHeight / (vh + bh)

							const blurRadius = TODO_BLUR_RADIUS * 2
							// Doesn't matter if the image contains alpha or not, because we are applying gaussian blur,
							// the drawn image edges will contract because of the applied blur.
							// To prevent this, we scale the image a bit so that artifacts are not visible
							console.log('[!] Image data: ', img)
							content.drawImage(
								img,
								// bw, bh are used to fix the removed scrollbar missing space
								pos.x * scl_w - bw - blurRadius,
								pos.y * scl_h - bh - blurRadius,
								w * scl_w + bw + blurRadius * 2,
								h * scl_h + bh + blurRadius * 2
							)
							//
              // StackBlur.canvasRGB(
              //   content.canvas,
              //   0,
              //   0,
              //   content.canvas.width,
              //   content.canvas.height,
              //   TODO_BLUR_RADIUS
              // )

							//* Fast blur implementation
							let idata = content.getImageData(
									0,
									0,
									content.canvas.width,
									content.canvas.height
								), // assumes ctx/w/h to be defined
								rgba = idata.data,
								len = content.canvas.width * content.canvas.height,
								radius = 2, //TODO: NO IDEA HOW TO FIX OVERLAPPING AND REPEATED SQUARES...
								rSrc = new Uint8Array(len), // source arrays
								gSrc = new Uint8Array(len),
								bSrc = new Uint8Array(len),
								// target arrays
								rTrg = new Uint8Array(len), // source arrays
								gTrg = new Uint8Array(len),
								bTrg = new Uint8Array(len),
								// define target arrays the same way as above
								i = 0,
								offset = 0

							for (; i < len; i++) {
								rSrc[i] = rgba[offset++]
								gSrc[i] = rgba[offset++]
								bSrc[i] = rgba[offset++]
							}

							//? source channel, target channel, width, height, radius
							gaussBlur_4(rSrc, rTrg, w, h, radius)
							gaussBlur_4(gSrc, gTrg, w, h, radius)
							gaussBlur_4(bSrc, bTrg, w, h, radius)

							for (i = 0, offset = 0; i < len; i++) {
								rgba[offset++] = rTrg[i]
								rgba[offset++] = gTrg[i]
								rgba[offset++] = bTrg[i]
							}

							content.putImageData(idata, 0, 0)

							DebugDraw(content, { x, y, w, h, scale, n })
						})
					})
					*/
				})
			}
		}
		await jobs.serial().then(restoreScrollPosition)
		console.timeEnd('decoding')

		if (badge) {
			await browserAction.setTitle({ title: T$('badge_saving'), tabId: tab.id })
			await browserAction.setBadgeText({ text: '...', tabId: tab.id })
			await browserAction.setBadgeBackgroundColor({
				color: 'green',
				tabId: tab.id,
			})
		}
		await browserAction.enable(tab.id)
		mutex.unlock(key)

		await decoding.parallel()
		//console.log("BASE64 IMG:\n", content.canvas.toDataURL("image/jpeg"));
		//const buff = await fetch(content.canvas.toDataURL('image/jpg', quality))
		//applyTheme(tab.windowId, buff.url)
		// content = buff.arrayBuffer()
		const buff = content //content already is a base64 jpeg image
		applyTheme(tab.windowId, buff)
	} catch (err) {
		console.error(err)
		alarm(`Failed to generate image\nReason: ${err}`, { id: nid })
		restoreScrollPosition().catch(ignore)
	} finally {
		if (await mutex.lock(key, { retry: false })) {
			if (badge) {
				await browserAction.setTitle({ title: '', tabId: tab.id })
				await browserAction.setBadgeText({ text: '', tabId: tab.id })
				try {
					await browserAction.setBadgeBackgroundColor({
						color: null,
						tabId: tab.id,
					})
				} catch (err) {
					await browserAction.setBadgeBackgroundColor({
						color: '',
						tabId: tab.id,
					})
				}
			}
			await browserAction.enable(tab.id)
			mutex.unlock(key)
		}
		mutex.unlock('worker')
	}
}

function DebugDraw(ctx, info) {
	if (!DEBUG_DRAW) return
	ctx.save()
	ctx.scale(info.scale, info.scale)
	ctx.fillStyle = [
		'rgba(255,0,0,0.1)',
		'rgba(0,255,0,0.1)',
		'rgba(0,0,255,0.1)',
	][info.n % 3]
	ctx.font = `${50 * info.scale}px sans-serif`
	ctx.textBaseline = 'top'
	ctx.strokeStyle = '#000'
	ctx.setLineDash([5, 5])
	ctx.lineWidth = 1
	ctx.fillRect(info.x, info.y, info.w, info.h)
	ctx.strokeRect(info.x, info.y, info.w, info.h)
	ctx.setLineDash([])
	ctx.lineWidth = 2
	ctx.strokeStyle = '#fff'
	ctx.strokeText(info.n, info.x, info.y, info.w)
	ctx.fillStyle = '#000'
	ctx.fillText(info.n, info.x, info.y, info.w)
	ctx.restore()
}

// Migrates old "only one possible" preferences to new "multi select" model
async function MigrateSettings() {
	const prefs = await Storage.get()
	const newprefs = {}
	if ('region' in prefs) {
		if (prefs.region == 'manual')
			newprefs.regions = ['full', 'viewport', 'selection']
		else newprefs.regions = [prefs.region]
		await Storage.remove('region')
	}
	if ('format' in prefs) {
		if (prefs.format == 'manual') newprefs.formats = ['png', 'jpg', 'copy']
		else newprefs.formats = [prefs.format]
		await Storage.remove('format')
	}
	await Storage.set(newprefs)
}

let userTheme = null
async function getUserTheme(windowID, invalidate = false) {
	// TODO: rerun function when user changes theme
	// TODO: add setting to tweak what colors will be used
	if (userTheme && !invalidate) return userTheme
	const theme = await browser.theme.getCurrent(windowID)
	console.log('User theme:', theme)
	if (theme.colors?.popup) {
		// We use the popup background color as this one often match the background of the toolbar
		const [r, g, b] = anyToRgba(theme.colors.popup)
		theme.colors.toolbar = `rgba(${r},${g},${b},0.25)`
	} else if (theme.colors?.toolbar) {
		// Default to toolbar
		const [r, g, b] = anyToRgba(theme.colors.toolbar)
		theme.colors.toolbar = `rgba(${r},${g},${b},0.25)`
	}
	userTheme = theme
	return userTheme // don't return theme directly as we want JS engine to optimize userTheme
}
getUserTheme()

let bufferCurrent = null
const bufferTop = []
const bufferBottom = []
const bufferSize = 5 // current, last 2, next 2 images

// TODO: ensure bufferSize will be even or allow custom sizes for next and bottom
const ALLOWED_BUFFER_SIZE_PER_POSITION = (bufferSize - 1) / 2

let bgAliment = null
function getBufferSizeMemo(thisBufferSize) {
	if (thisBufferSize === bufferSize && bgAliment?.length) return bgAliment

	bgAliment = Array(bufferSize).fill('center top')
	return bgAliment
}

// TODO: implement scrollDirection, change background position based on scroll
// TODO: cache between backgrounds tabs
async function applyTheme(windowID, base64Url, scrollDirection) {
	/*
	 * To pre-load images using the background property hack,
	 * the buffering works in 3 steps:
	 *  1) On first load, whe don't need to do anything as the background
	 *     will be inherited from the theme-color
	 */

	if (bufferCurrent) {
		if (bufferTop.length === ALLOWED_BUFFER_SIZE_PER_POSITION) {
			// Replace first element with the next
			bufferTop.shift()
		}
		// Push next background
		bufferTop.push(bufferCurrent)
	}

	bufferBottom.push(base64Url) // Push as last element
	if (bufferBottom.length === ALLOWED_BUFFER_SIZE_PER_POSITION) {
		// Pop first element and assing to current
		bufferCurrent = bufferBottom.shift()
	}

	// Current buffer is the background the user will see,
	// bufferBottom are the cached backgrounds so can be replaced without flikering,
	// and at last are the top background as cache if user scrolls up.
	const backgrounds = [bufferCurrent, ...bufferBottom].filter((n) => n)

	// console.log('userTheme: ', userTheme)
	const idTime = Date.now()
	console.time('draw_timer_' + idTime)

	const theme = {
		// Transparent pixel gif:
		// data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==
		colors: {
			// Shallow cpy user theme
			...userTheme?.colors,

			/*
			 * #0000 is used instead of directly using "transparent" as some fields verify the opacity and reject if transparent.
			 * See: https://github.com/mozilla/gecko-dev/blob/master/toolkit/modules/LightweightThemeConsumer.sys.mjs
			 */
			// frame: '#0000', // TODO: use user theme
			// toolbar: '#0000', // bottom toolbar container + bookmarks
			toolbar_field: 'rgba(0,0,0,.25)', // URL bar
			toolbar_top_separator: 'transparent',
			toolbar_bottom_separator: 'transparent',
		},
		images: {
			additional_backgrounds: backgrounds,
		},
		properties: {
			// All background properties expect an array for every item in `additional_backgrounds`
			additional_backgrounds_alignment: getBufferSizeMemo(bufferSize),
			// additional_backgrounds_tiling: Array(bufferSize).fill("no-repeat"), Already the default value
			color_scheme: userTheme.properties?.color_scheme,
		},
	}
	browser.theme.update(windowID, theme)
	console.timeEnd('draw_timer_' + idTime)
}

function PruneCache() {
	bufferCurrent = null
	bufferBottom.length = 0
	bufferTop.length = 0
}

async function Startup() {
	await MigrateSettings()
	await UpdateUI()
}

// Register event listeners
browser.contextMenus.onClicked.addListener(ContextMenuClicked)
browser.browserAction.onClicked.addListener(ToolbarButtonClicked)
browser.commands.onCommand.addListener(CommandPressed)

Startup()
