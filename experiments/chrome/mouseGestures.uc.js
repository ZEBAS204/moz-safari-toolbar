// ==UserScript==
// @name            Mouse Gestures
// @author          xiaoxiaoflood
// @include         main
// @startup         UC.MGest.exec(win);
// @shutdown        UC.MGest.destroy();
// @onlyonce
// ==/UserScript==
// Using https://github.com/xiaoxiaoflood/firefox-scripts
// Using Mouse Gestures file as template: https://github.com/xiaoxiaoflood/firefox-scripts/blob/master/chrome/mouseGestures.uc.js
'use strict'

//* CAPTURE CONSTANTS TOOK FROM: https://searchfox.org/mozilla-central/source/browser/components/screenshots/ScreenshotsUtils.sys.mjs
// The max dimension for a canvas is 32,767 https://searchfox.org/mozilla-central/rev/f40d29a11f2eb4685256b59934e637012ea6fb78/gfx/cairo/cairo/src/cairo-image-surface.c#62.
// The max number of pixels for a canvas is 472,907,776 pixels (i.e., 22,528 x 20,992) https://developer.mozilla.org/en-US/docs/Web/HTML/Element/canvas#maximum_canvas_size
// We have to limit screenshots to these dimensions otherwise it will cause an error.
const MAX_CAPTURE_DIMENSION = 32766 //* gfx.max-texture-size =		32767 - 1
//																		* gfx.max-alloc-size   =		2147483647
const MAX_CAPTURE_AREA = 472907776
const MAX_SNAPSHOT_DIMENSION = 2000 //1024
const CONTEXT_SETTINGS = {
	alpha: false,
	// If true, the canvas must be created, drawn to, and read from entirely on the CPU.
	// Depends on pref gfx.canvas.willreadfrequently.enabled
	willReadFrequently: false,
}

const BLUR_TYPES = {
	NONE: 'none',
	ACRYLIC: 'acrylic', // 60px
	MICA: 'mica', // 40px
	MICA_ALT: 'mica_alt', // 80px
	TRANSPARENT: 'transparent', // 5px
}

const { XPCOMUtils } = ChromeUtils.import(
	'resource://gre/modules/XPCOMUtils.jsm'
)

const gBrowser = window.gBrowser

/**
 * Track and store event listeners
 */
class EventTracker {
	constructor() {
		if (EventTracker._instance) {
			// Prevent additional instances from being created
			return EventTracker._instance
		}

		// Initialize the event registry
		this.eventRegistry = {}
		EventTracker._instance = this
	}

	// Static getter to access the singleton instance
	static get instance() {
		if (!EventTracker._instance) {
			new EventTracker()
		}
		return EventTracker._instance
	}

	// Add an event listener and track it
	static addTrackedEventListener(element, eventType, listener) {
		if (!element) {
			console.error('No element provided to the Event Tracker Listener!')
			return
		}

		const tracker = EventTracker.instance // Access singleton instance

		// Generate a unique key for the element and event type
		const key = tracker._getElementKey(element) + `-${eventType}`

		// Initialize registry for the element and event type if not already present
		if (!tracker.eventRegistry[key]) {
			tracker.eventRegistry[key] = []
		}

		// Add the event listener
		element.addEventListener(eventType, listener)

		// Store the listener in the registry
		tracker.eventRegistry[key].push({
			element,
			eventType,
			listener,
		})
	}

	// Remove all tracked event listeners
	static removeAllTrackedEventListeners() {
		const tracker = EventTracker.instance // Access singleton instance

		Object.keys(tracker.eventRegistry).forEach((key) => {
			const listeners = tracker.eventRegistry[key]
			if (listeners) {
				listeners.forEach(({ element, eventType, listener }) => {
					if (element) {
						element.removeEventListener(eventType, listener)
					}
				})
			}
		})

		// Clear the registry
		tracker.eventRegistry = {}
	}

	// Generate a unique key for an element based on its ID or class
	_getElementKey(element) {
		return `${element.tagName}-${element.id || element.className}`
	}

	// List all tracked events
	static listTrackedEvents() {
		const tracker = EventTracker.instance // Access singleton instance

		return Object.keys(tracker.eventRegistry).reduce((acc, key) => {
			const listeners = tracker.eventRegistry[key]
			if (listeners) {
				listeners.forEach(({ element, eventType, listener }) => {
					acc.push({
						element,
						eventType,
						listener,
					})
				})
			}
			return acc
		}, [])
	}

	static destroy() {
		EventTracker.removeAllTrackedEventListeners()
	}
}

const lazy = {}
ChromeUtils.defineESModuleGetters(lazy, {
	BrowserUtils: 'resource://gre/modules/BrowserUtils.sys.mjs',
	PrivateBrowsingUtils: 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs',
	ActorManagerParent: 'resource://gre/modules/ActorManagerParent.sys.mjs',
	clearTimeout: 'resource://gre/modules/Timer.sys.mjs',
	setTimeout: 'resource://gre/modules/Timer.sys.mjs',
})

const GLOBAL_MESSAGE_MANAGER =
	Cc['@mozilla.org/globalmessagemanager;1'].getService()

console.log('AAAAAAAAAAAAAAAAAAAAAAAA', this, window, lazy)

const IS_PRIVATE_WINDOW = lazy.PrivateBrowsingUtils.isWindowPrivate(
	window.gBrowser.ownerGlobal
)

//* Sidebar compatibility
// TODO: do something with sidebar?
const SIDEBAR_ENABLED_PREF = 'sidebar.revamp'
const IS_SIDEBAR_ENABLED = Services.prefs.getBoolPref(SIDEBAR_ENABLED_PREF)

// TODO: make this object an actual class
UC.MGest = {
	// debug tracking to know how this context works
	_isNewInstance: true,
	DEBUG_DYNAMIC_TABS: true,

	_tabProcessingQueue: new WeakMap(),
	getDimensions_cache: null,

	_currentTab: window.gBrowser.selectedTab,
	CANVAS: window.document.getElementById('snapshotCanvas'),
	DEBUG_CANVAS: window.document.getElementById('snapshotCanvas_DEBUG'),

	/**
	 * @typedef {Object} BufferData
	 * @property {ImageData} [imgData] - The image data associated with the buffer.
	 * @property {boolean} [isRectCrop] - If the rect dimensions where cropped
	 * @property {Rect} [rect] - The rectangle defining the area of screenshot.
	 * @property {number} rect.width - The width of the rectangle.
	 * @property {number} rect.height - The height of the rectangle.
	 * @property {number} rect.top - The top position of the rectangle.
	 * @property {number} rect.left - The left position of the rectangle.
	 * @property {number} rect.right - The right position of the rectangle.
	 * @property {number} rect.bottom - The bottom position of the rectangle.
	 */
	/**
	 * Holds information of all tracked tabs
	 * @type {WeakMap<object, BufferData>}
	 */
	_buffers: new WeakMap(),

	/**
	 * Holds information of all tabs that have been cached by firefox (eg. newtab)
	 * @type {Map<object, BufferData>}
	 */
	_cachedBuffers: new Map(),

	/**
	 * @param {Element} aTab - The tab element for which the buffer data is being set.
	 * @param {keyof BufferData} dataName - The name/key of the buffer data to update or add.
	 * @param {any} data - The new buffer data to set for the given `dataName`.
	 *
	 * @returns {void}
	 */
	setTabBuffer: function (aTab, dataName, data) {
		const currentData = this._buffers.get(aTab) || {}
		this._buffers.set(aTab, {
			...currentData,
			[dataName]: data,
		})
	},

	/**
	 * Caches the result of the different elements dimensions in memory to avoid triggering uninterruptible layout reflows
	 * @param {boolean} [reflow=false] - Whether to force reflow to recalculate dimensions.
	 * @returns {{
	 *   ContentRect: DOMRect,
	 *   BrowserWidth: number,
	 *   BrowserHeight: number,
	 *   TBrect: DOMRect,
	 *   TBwidth: number,
	 *   TBheight: number
	 * }}
	 * - `ContentRect`: DOMRect representing the content area dimensions.
	 * - `BrowserWidth`: Width of the browser window.
	 * - `BrowserHeight`: Height of the browser window.
	 * - `TBrect`: DOMRect representing the toolbox area dimensions.
	 * - `TBwidth`: Width of the toolbox element.
	 * - `TBheight`: Height of the toolbox element.
	 */
	getDimensions: function (reflow = false) {
		if (!reflow && this.getDimensions_cache) return this.getDimensions_cache

		const { height: BrowserHeight, width: BrowserWidth } =
			window.document.body.getBoundingClientRect()

		const { width: TBwidth, height: TBheight } =
			window.gNavToolbox.getBoundingClientRect()

		const { x: xContentOffset, y: yContentOffset } =
			window.gBrowser.selectedBrowser.getBoundingClientRect()

		const TBrect = new DOMRect(0, TBheight, TBwidth, BrowserHeight - TBheight)
		const ContentRect = new DOMRect(
			gBrowser.selectedBrowser.screenX,
			gBrowser.selectedBrowser.screenY,
			BrowserWidth - gBrowser.selectedBrowser.screenX,
			BrowserHeight - -gBrowser.selectedBrowser.screenY
		)

		this.getDimensions_cache = {
			ContentRect,
			BrowserWidth,
			BrowserHeight,
			TBrect,
			TBwidth,
			TBheight,
			xContentOffset,
			yContentOffset,
		}
		return this.getDimensions_cache
	},

	getScale: function () {
		const scale =
			window.devicePixelRatio * window.gBrowser.selectedBrowser.fullZoom
		//const scale = Math.round(window.gBrowser.selectedBrowser.fullZoom * 100) / 100

		return scale
	},

	// FIXME: MIGRATE to webassembly, jankiness is produced by this calculation
	// TODO: avoid using the image data from canvas, use the raw bitmap directly
	// TODO: use the first bitmap as reference instead of re-getting the image data from the canvas, TBheight defines the amount of loops to perform
	fullExpandPixelRow: function (canvas, ctx, bitmap) {
		const { TBwidth, TBheight } = this.getDimensions()

		const START_HEIGHT = 0
		const PIXEL_ROWS_TO_USE = 4

		const firstRow = ctx.getImageData(
			0,
			START_HEIGHT,
			canvas.width,
			PIXEL_ROWS_TO_USE
		)
		const { data: firstRowData } = firstRow

		const imageData = ctx.getImageData(0, 0, TBwidth, TBheight)
		const data = imageData.data

		// imageData.data is a Uint8ClampedArray containing RGBA values
		// Make a seamless verticall pattern with the first 4 pixel rows
		for (let i = 0, j = 0; i < data.length; i += 4, j += 4) {
			if (j == firstRowData.length) j = 0

			data[i] = firstRowData[j] // red
			data[i + 1] = firstRowData[j + 1] // green
			data[i + 2] = firstRowData[j + 2] // blue
			// We can ignore alpha
		}

		//! DEBUG
		//ctx.putImageData(firstRow, 0, 380)

		// Draw
		ctx.putImageData(imageData, 0, 0)
	},

	cropScreenshotRectIfNeeded: function (rect, aTab = null) {
		if (aTab) {
			const savedBuffer = this._buffers.get(aTab)
			if (savedBuffer?.isRectCrop) {
				console.log('Using saved rect without cropping')
				return savedBuffer.rect
			}
		}
		console.info('Cropping rect:', rect, [aTab])

		let cropped = false
		let width = rect.width * window.devicePixelRatio
		let height = rect.height * window.devicePixelRatio
		const {
			BrowserHeight,
			BrowserWidth,
			TBheight: ToolbarHeight,
		} = this.getDimensions()

		if (width > MAX_CAPTURE_DIMENSION) {
			width = MAX_CAPTURE_DIMENSION
			cropped = true
		}
		if (height > MAX_CAPTURE_DIMENSION) {
			height = MAX_CAPTURE_DIMENSION
			cropped = true
		}
		if (width * height > MAX_CAPTURE_AREA) {
			height = Math.floor(MAX_CAPTURE_AREA / width)
			cropped = true
		}
		if (width > BrowserWidth) {
			console.info('[OPTIMIZATION] Rect exceeding browser width')
			width = BrowserWidth
		}

		if (height <= BrowserHeight) {
			console.info(
				'[OPTIMIZATION] Rect fit only toolbar, only taking screenshot of toolbar height'
			)
			height = ToolbarHeight
		} else if (rect.height >= BrowserHeight) {
			// TODO: add a tiny space to account for infinite scrolling
			console.info(
				'[OPTIMIZATION] Removing window - toolbar height of screenshot'
			)
			height = Math.max(height - BrowserHeight + ToolbarHeight * 2, 0)
		}

		//* TEMP FIX
		//* Use the total screen width instead the rect width, this is because absolute/relative positioning may break the screenshot dimensions
		// rect.width = Math.floor(width / rect.devicePixelRatio)
		rect.width = Math.floor(BrowserWidth / window.devicePixelRatio)
		rect.height = Math.floor(height / window.devicePixelRatio)
		rect.right = rect.left + rect.width
		rect.bottom = rect.top + rect.height

		// FIXME: do this in a single call and stop writting spaguetti code
		rect.left = Math.round(rect.left)
		rect.right = Math.round(rect.right)
		rect.top = Math.round(rect.top)
		rect.bottom = Math.round(rect.bottom)
		rect.width = Math.round(rect.right - rect.left)
		rect.height = Math.round(rect.bottom - rect.top)

		if (aTab) {
			// TODO: improve method to save buffer as this should be done in a single call
			console.log('Saving RECT BUFFER', rect, aTab)
			this.setTabBuffer(aTab, 'isRectCrop', true)
			this.setTabBuffer(aTab, 'rect', rect)
		}
		if (cropped) console.warn('SCREENSHOT CROPPED!\nMax area:', width * height)

		return rect
	},

	processSnapshot: async function (aTab) {
		// TODO: make this function cancellable/resumable?

		const buffer = this._buffers.get(aTab)
		if (!buffer?.rect) return -1

		// Reduce the amount of memory used by the canvas
		const region = this.cropScreenshotRectIfNeeded(buffer.rect, aTab)

		const browsingContext = aTab.browsingContext
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)

		console.info(
			'Setting canvas region\nwidthxheight',
			[region?.width, region?.height],
			region
		)

		Object.assign(this.CANVAS, {
			width: region.width * window.devicePixelRatio,
			height: region.height * window.devicePixelRatio,
		})

		const snapshotSize = Math.floor(
			MAX_SNAPSHOT_DIMENSION * window.devicePixelRatio
		)

		console.time('DynamicTabBar:TotalDrawTime') //* Debug

		// Add offset so start after the Toolbar region paint
		// TODO: change offset dynamically
		const { xContentOffset, yContentOffset } = this.getDimensions()
		if (region.height <= yContentOffset) {
			console.log('Ignoring draw request as content is only toolbar height')
			return 1
		}

		//! Iterates from Left to right, then top to bottom
		for (
			let startTop = region.top;
			startTop < region.bottom;
			startTop += MAX_SNAPSHOT_DIMENSION
		) {
			for (
				let startLeft = region.left;
				startLeft < region.right;
				startLeft += MAX_SNAPSHOT_DIMENSION
			) {
				console.time('DynamicTabBar:SnapshotTime')

				let height =
					startTop + MAX_SNAPSHOT_DIMENSION > region.bottom
						? region.bottom - startTop
						: MAX_SNAPSHOT_DIMENSION
				let width =
					startLeft + MAX_SNAPSHOT_DIMENSION > region.right
						? region.right - startLeft
						: MAX_SNAPSHOT_DIMENSION
				let rect = new DOMRect(startLeft, startTop, width, height)

				let startSnapshotTime = window.performance.now()
				let snapshot = await browsingContext.currentWindowGlobal.drawSnapshot(
					rect,
					window.devicePixelRatio,
					'rgb(255,255,255)'
				)

				//* Debug
				let endSnapshotTime = window.performance.now()
				console.log(
					`Snapshot Time took: ${endSnapshotTime - startSnapshotTime} ms`
				)

				let left = Math.floor(
					(startLeft - region.left) * window.devicePixelRatio
				)
				let top = Math.floor((startTop - region.top) * window.devicePixelRatio)
				ctx.drawImage(
					snapshot,
					left - (left % snapshotSize) + xContentOffset, // Start drawing after the sidebar (if any)
					top - (top % snapshotSize) + yContentOffset, // Start drawing after the toolbar height
					Math.floor(width * window.devicePixelRatio),
					Math.floor(height * window.devicePixelRatio)
				)

				snapshot.close()
				console.timeEnd('DynamicTabBar:SnapshotTime') //* Debug
			}
		}

		//* Debug
		console.timeEnd('DynamicTabBar:TotalDrawTime')
		return 1
	},

	dynamicScreenshot: async function () {
		const tabRef = gBrowser.selectedBrowser

		if (this._tabProcessingQueue.has(tabRef)) {
			console.log('Ignoring draw request, tab already on queue', tabRef)
			return
		}

		console.log('Adding tab to processing queue', tabRef)
		//* Create an AbortController
		//* https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal#implementing_an_abortable_api
		// const abortController = new AbortController()
		// const { signal } = abortController
		// this._tabProcessingQueue.set(tabRef, 'abortSignal', signal)
		this._tabProcessingQueue.set(tabRef, 'processing')

		this._dynamicScreenshot(arguments).finally(() => {
			console.log('Removing tab of processing queue:', tabRef)
			this._tabProcessingQueue.delete(tabRef)
		})
	},

	_dynamicScreenshot: async function (force = false, overrideColor = null) {
		window.console.time('dynamicScreenshot')
		console.log(`dynamicScreenshot(${force ? 'true' : 'false'})`)
		const { TBwidth, TBheight, ContentRect } = this.getDimensions()

		// Todo: check if handling fullscreen is actually needed...
		if (window.fullScreen && window.FullScreen.navToolboxHidden) {
			console.log('fullscreen detected, ignoring screenshot')
			return
		}

		// Since requestAnimationFrame callback is generally triggered
		// before any style flush and layout, we should wait for the
		// second animation frame.
		await new Promise((r) => window.requestAnimationFrame(r))
		// Defer paint to the next tick of the event loop since
		//Services.tm.dispatchToMainThread(async () => {
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)

		// update dimensions
		this.CANVAS.width = TBwidth
		this.CANVAS.height = ContentRect.height

		if (!force) {
			const _currentTab = this._currentTab
			const savedBuffer = this._buffers.get(_currentTab)
			if (savedBuffer?.imgData) {
				const { imgData } = savedBuffer
				console.log(
					'Using saved buffer image data of tab',
					_currentTab,
					imgData
				)
				ctx.putImageData(imgData, 0, 0)
				return
			}
		}

		// Apply pattern if requested
		this.firstLoadScreenshot(overrideColor)
		this.setTabBuffer(gBrowser.selectedBrowser, 'isRectCrop', false)

		const result = await this.processSnapshot(gBrowser.selectedBrowser)

		//* Default way of getting the snapshot
		if (!result) {
			console.info('Using default screenshot way\nError code:', result)
			// Get the canvas context and draw the snapshot
			const scale = this.getScale()
			const imgBitmap =
				await window.browsingContext.currentWindowGlobal.drawSnapshot(
					ContentRect, // DOMRect
					scale, // Scale
					'rgb(255, 255, 255)', // Background (required)
					false // fullViewport
				)
			// TODO: handling screenshot gaps:
			// https://searchfox.org/mozilla-central/source/browser/components/screenshots/ScreenshotsUtils.sys.mjs#1041

			ctx.drawImage(imgBitmap, 0, TBheight) // start draw under the toolbar image
			if (this.DEBUG_DYNAMIC_TABS) {
				this.DEBUG_CANVAS.getContext('2d', { alpha: false }).drawImage(
					imgBitmap,
					0,
					0
				)
			}

			imgBitmap.close()
		}
		window.console.timeEnd('dynamicScreenshot')

		// Wait till the canvas finish painting
		lazy.setTimeout(() => {
			const saveImageBuffer = ctx.getImageData(
				0,
				0,
				this.CANVAS.width,
				this.CANVAS.height
			)
			console.log(
				'creating buffer for tab:',
				window.gBrowser.selectedTab,
				saveImageBuffer
			)
			// Save image data as buffer (currentData could be not yet set, use a empty object)
			this.setTabBuffer(window.gBrowser.selectedTab, 'imgData', saveImageBuffer)
		})
	},

	firstLoadScreenshot: async function (overrideColor = null) {
		window.console.time('firstLoadScreenshot')
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)

		// TODO: sanitize overrideColor
		if (overrideColor) {
			console.info('Using theme color override:', overrideColor)
			ctx.fillStyle = 'overrideColor' // Set the color you want for the rectangle
			ctx.fillRect(0, 0, this.CANVAS.width, this.CANVAS.height)

			window.console.timeEnd('firstLoadScreenshot')
			return
		}

		const { TBrect } = this.getDimensions()
		const scale = this.getScale()
		const imgBitmap =
			await window.browsingContext.currentWindowGlobal.drawSnapshot(
				TBrect, // DOMRect
				scale, // Scale
				'rgb(255, 255, 255)', // Background (required)
				false // fullViewport
			)

		ctx.drawImage(imgBitmap, 0, 0)

		window.console.timeEnd('firstLoadScreenshot')

		// Apply pattern if requested
		// Note: when using this pattern method, BLUR FILTER MUST BE DISABLED
		// TODO: use Element.animate (https://hacks.mozilla.org/2016/08/animating-like-you-just-dont-care-with-element-animate)
		this.CANVAS.style.transform = 'translateY(0px)'
		console.debug('fullExpandPixelRow bitmap:', imgBitmap)
		this.fullExpandPixelRow(this.CANVAS, ctx, imgBitmap)
		imgBitmap.close()
	},

	/**
	 * Utility debounce function
	 * @param {Function} func The function to debounce
	 * @param {number} delayMs The wait period
	 * @return {Function} The debounced function, which has a `cancel` method that the consumer can call to cancel any pending setTimeout callback.
	 * @see https://searchfox.org/mozilla-central/source/devtools/shared/debounce.js
	 */
	debounce: function (func, wait, scope) {
		let timer = null

		function clearTimer(resetTimer = false) {
			if (timer) {
				lazy.clearTimeout(timer)
			}
			if (resetTimer) {
				timer = null
			}
		}

		const debouncedFunction = function () {
			clearTimer()

			const args = arguments
			timer = lazy.setTimeout(function () {
				timer = null
				func.apply(scope, args)
			}, wait)
		}

		debouncedFunction.cancel = clearTimer.bind(null, true)

		return debouncedFunction
	},

	speculativeLoadTab: function () {
		//* https://searchfox.org/mozilla-central/source/browser/components/tabbrowser/content/tab.js#587
		// If the tab was tracker, preload the cache content in an offscreencanvas
		// remove if the tab is unhovered (timer based?)
	},

	setupDynamicListeners: function () {
		EventTracker.removeAllTrackedEventListeners()

		// Toolbox Customization glue support
		/*
		EventTracker.addTrackedEventListener(
			window.gNavToolbox,
			'customizationstarting',
			window.requestAnimationFrame(function (event) {
				console.log(
					'Browser Chrome Customization started, hiding canvas',
					event
				)
				// TODO: cancel canvas paint

				window.gNavToolbox.addEventListener('aftercustomization', (event) => {
					// restore?
				}, {once: true})
			})
		)
		*/

		window.gNavToolbox.querySelectorAll('toolbar').forEach((childToolbar) => {
			EventTracker.addTrackedEventListener(
				childToolbar,
				'toolbarvisibilitychange',
				(event) => {
					console.log('toolbarvisibilitychange', event, {
						isToolbarVisible: event.detail.visible,
					})
					window.addEventListener(
						'MozAfterPaint',
						async () => {
							// Since requestAnimationFrame callback is generally triggered
							// before any style flush and layout, we should wait for the
							// second animation frame.
							await new Promise((r) => window.requestAnimationFrame(r))
							await new Promise((r) => window.requestAnimationFrame(r))

							this.getDimensions(true)
							// TODO: optimization, instead of redrawing everything from scratch, just create a variable to
							// account for and add the offset of the new toolbar height...?
							this.dynamicScreenshot(true)
						},
						{ once: true }
					)
				}
			)
		})

		EventTracker.addTrackedEventListener(
			window,
			'EndSwapDocShells',
			(event) => {
				console.log('EndSwapDocShells', event)
			}
		)

		EventTracker.addTrackedEventListener(
			window.gBrowser.tabContainer,
			'TabSelect',
			(event) => {
				console.log('Tab selected!', event)
				// Store the ImageData in the WeakMap with the current window as the key
				this._currentTab = window.gBrowser.selectedTab
				this.dynamicScreenshot()
			}
		)

		EventTracker.addTrackedEventListener(
			window.gBrowser.tabContainer,
			'oop-browser-crashed',
			(event) => {
				console.log('Tab crashed, discarting buffers!', event)
				if (event.isTopFrame) {
				}
			}
		)

		EventTracker.addTrackedEventListener(
			window,
			'resize',
			this.debounce((event) => {
				// console.log('Window resized!', event)
				this.getDimensions(true)
				this.dynamicScreenshot()
			}, 300)
		)
		EventTracker.addTrackedEventListener(
			window,
			'FullZoomChange',
			this.debounce((event) => {
				console.log('Changed zoom!', event)
				console.log(
					'Device Pixel Ratio:',
					window.devicePixelRatio,
					'\nfullZoom:',
					window.gBrowser.selectedBrowser.fullZoom,
					'\nCalculated Scale =',
					this.getScale()
				)
				this.getDimensions(true)
				this.dynamicScreenshot()
			}, 300)
		)

		EventTracker.addTrackedEventListener(
			this.CANVAS,
			'contextlost',
			(event) => {
				this._contextLost = true
				console.log('Canvas contextlost!', event)
				this.CANVAS.addEventListener('contextrestored', (event) => {
					// TODO: handle contextlost event
					console.log('Canvas context restored!', event)
					this._contextLost = false
				})
			}
		)
	},

	/**
	 * TESTING FUNCTIONS
	 */
	TEST_createScrollSlider: function () {
		// Create slider container and slider elements
		let sliderContainer = window.document.getElementById(
			'dynamic-sliderContainer'
		)
		let slider = window.document.getElementById('dynamic-sliderContainer-input')
		let sliderValue = window.document.getElementById(
			'dynamic-sliderContainer-value'
		)
		let takeScreenshotButton = window.document.getElementById(
			'dynamic-sliderContainer-screenshotBTN'
		)
		if (!sliderContainer) {
			sliderContainer = window.document.createElement('div')
			sliderContainer.id = 'dynamic-sliderContainer'
			sliderContainer.style.width = '100%' // Adjust width as needed
			sliderContainer.style.maxWidth = '10vw' // Max width for better responsiveness
			sliderContainer.style.textAlign = 'center'
			sliderContainer.style.left = '5px'
			sliderContainer.style.bottom = '5px'
			sliderContainer.style.position = 'fixed'

			slider = window.document.createElement('input')
			slider.id = 'dynamic-sliderContainer-input'
			slider.type = 'range'
			slider.min = 0
			slider.step = 1

			takeScreenshotButton = window.document.createElement('button')
			takeScreenshotButton.textContent = 'Take screenshot'
			takeScreenshotButton.id = 'dynamic-sliderContainer-screenshotBTN'
			takeScreenshotButton.addEventListener('click', () => {
				this.dynamicScreenshot(true)
			})

			// Get the height of the window.document body and set as max value for the slider
			const bodyHeight = window.document.body.getBoundingClientRect().height
			slider.max = bodyHeight

			// Display current value of the slider
			sliderValue = window.document.createElement('div')
			sliderValue.id = 'dynamic-sliderContainer-value'
			sliderValue.textContent = '0'

			const blurSlider = window.document.createElement('input')
			blurSlider.type = 'range'
			blurSlider.value = this.DYNAMIC_TAB_BAR_BLUR_AMOUNT
			blurSlider.min = 0

			// Append slider and value elements to the container
			sliderContainer.appendChild(blurSlider)
			sliderContainer.appendChild(slider)
			sliderContainer.appendChild(sliderValue)
			sliderContainer.appendChild(takeScreenshotButton)

			// Append container to the window.document body
			window.document.body.appendChild(sliderContainer)

			// Add blur slider
			blurSlider.addEventListener('input', () => {
				this.CANVAS.style.filter = `blur(${blurSlider.value}px)`
			})
		}

		// Return an object with references to slider and listeners
		return {
			slider,
			sliderValue,
		}
	},

	TEST_setupScrollEvents: function (remove) {
		window.document.getElementById('dynamic-sliderContainer')?.remove()
		if (remove) return // we always re-create everything when reloading, just stop the function

		// Call the function to create the slider
		const { slider, sliderValue } = this.TEST_createScrollSlider()

		const changeListener = () => {
			if (this.CANVAS) {
				const value = slider.value
				sliderValue.textContent = value
				this.CANVAS.style.transform = `translateY(-${value}px)`
				//console.log('Slider value changed to:', value)
			}
		}

		// Re-add events
		slider.addEventListener('input', changeListener)
	},

	/**
	 * Get/Remove all the elements that will be used.
	 */
	initializeElements: function (remove = false) {
		// TODO: initialize canvas here as we will need some events to be set on setupDynamicListeners()
		this.initializeStyles(remove)
		const debugCanvasID = 'snapshotCanvas_DEBUG'
		const canvasID = 'snapshotCanvas'

		this.DEBUG_CANVAS = window.document.getElementById(debugCanvasID)
		this.CANVAS = window.document.getElementById(canvasID)

		if (remove) {
			this.CANVAS?.remove()
			this.DEBUG_CANVAS?.remove()
		}
		if (this.CANVAS) return

		const { TBrect, TBwidth, TBheight } = this.getDimensions()
		if (this.DEBUG_DYNAMIC_TABS && !this.DEBUG_CANVAS) {
			this.DEBUG_CANVAS = window.document.createElement('canvas')
			this.DEBUG_CANVAS.id = debugCanvasID
			this.DEBUG_CANVAS.imageSmoothingEnabled = false
			this.DEBUG_CANVAS.mozOpaque = true
			this.DEBUG_CANVAS.style.position = 'fixed'
			this.DEBUG_CANVAS.style.bottom = '0'
			this.DEBUG_CANVAS.style.right = '0'
			this.DEBUG_CANVAS.style.pointerEvents = 'none'
			this.DEBUG_CANVAS.style.width = 'calc(100vw/4)'
			this.DEBUG_CANVAS.style.height = TBrect.height / 4
			this.DEBUG_CANVAS.width = TBwidth / 4
			this.DEBUG_CANVAS.height = TBheight / 4
			window.document.body.appendChild(this.DEBUG_CANVAS)
		}
		this.CANVAS = window.gBrowser.selectedBrowser.ownerDocument.createElementNS(
			'http://www.w3.org/1999/xhtml',
			'html:canvas'
		)
		this.CANVAS.id = canvasID
		this.CANVAS.imageSmoothingEnabled = false
		this.CANVAS.mozOpaque = true

		window.gNavToolbox.parentNode.insertBefore(this.CANVAS, window.gNavToolbox)

		this.TEST_setupScrollEvents(remove)
	},

	/**
	 * Add/Remove styles
	 */
	initializeStyles: function (remove) {
		const id = 'dynamictabbar-styles'
		if (remove) {
			window.document.getElementById(id)?.remove()
			return
		}

		const addStyles = (aCss, add) => {
			let styleElement = window.document.getElementById(id)
			if (!styleElement) {
				styleElement = window.document.createElement('style')
				styleElement.setAttribute('type', 'text/css')
				styleElement.id = id
				window.document.head.appendChild(styleElement)
			}
			if (add) styleElement.textContent += aCss
			else styleElement.textContent = aCss
		}
		const tb = window.gNavToolbox.id || '#navigator-toolbox'
		const showSecurityBorder = this.DYNAMIC_TAB_BAR_SECURITY_BORDER

		addStyles(`
      #snapshotCanvas {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        width: 100vw;
        will-change: transform;
        z-index: -1;
				transform-origin: center top 0;
      }

      /* Remove background and borders of the middle navigation bar */
			#${tb} > * {
				background: none !important;
				border-color: transparent !important;
			}

			#${tb} {
				background: none !important;
				${showSecurityBorder ? '' : 'border-color: transparent !important;'}
			}
      `)
	},

	/**
	 * Keeps track of the tab listeners so we can remove them later
	 */
	tabProgressListener: {},
	_init: function () {
		console.log('INIT!')

		const DEFAULT_TAB_BAR_ENABLED = true
		const DYNAMIC_TAB_BAR_ENABLED_PREF = 'dynamic.browser.component.enabled'
		XPCOMUtils.defineLazyPreferenceGetter(
			this,
			'DYNAMIC_TAB_BAR_ENABLED',
			DYNAMIC_TAB_BAR_ENABLED_PREF,
			DEFAULT_TAB_BAR_ENABLED,
			function onToggle(_pref, _prevVal, newVal) {
				if (newVal) {
					console.log('Dynamic Tab Bar enabled!')
					// TODO
					return
				}

				console.log('Dynamic Tab Bar disabled!')
				// TODO: cleanup()
			}
		)

		const DEFAULT_SECURITY_BORDER = true
		const DYNAMIC_TAB_BAR_SECURITY_BORDER_PREF =
			'dynamic.browser.component.security_border'
		XPCOMUtils.defineLazyPreferenceGetter(
			this,
			'DYNAMIC_TAB_BAR_SECURITY_BORDER',
			DYNAMIC_TAB_BAR_SECURITY_BORDER_PREF,
			DEFAULT_SECURITY_BORDER,
			function onSecurityBorderUpdate(_pref, _prevVal, newVal) {
				console.log('Updated Security border', newVal, globalThis)
			}
		)

		const DEFAULT_BLUR_TYPE = BLUR_TYPES.ACRYLIC
		const DYNAMIC_TAB_BAR_STYLE_PREF = 'dynamic.browser.component.blur_style'
		XPCOMUtils.defineLazyPreferenceGetter(
			this,
			'DYNAMIC_TAB_BAR_STYLE',
			DYNAMIC_TAB_BAR_STYLE_PREF,
			DEFAULT_BLUR_TYPE,
			function onBlurTypeUpdate(_pref, _prevVal, newVal) {
				console.log('Updated Blur Type', newVal)
				// TODO
			}
		)

		const DEFAULT_BLUR_AMOUNT = 60
		const DYNAMIC_TAB_BAR_BLUR_AMOUNT_PREF =
			'dynamic.browser.component.blur_amount'
		XPCOMUtils.defineLazyPreferenceGetter(
			this,
			'DYNAMIC_TAB_BAR_BLUR_AMOUNT',
			DYNAMIC_TAB_BAR_BLUR_AMOUNT_PREF,
			DEFAULT_BLUR_AMOUNT,
			function onBlurAmountUpdate(_pref, _prevVal, newVal) {
				// TODO validate new val
				// TODO cannot be negative
				const canvas = window.document.getElementById('snapshotCanvas')
				if (canvas) {
					console.log('Updated Blur Amount', newVal)
					canvas.style.filter = `blur(${newVal}px)`
				} else {
					console.error(
						'Updated Blur Amount failed due to canvas element missing!'
					)
				}
			}
		)

		this.initializeElements()
		this.getDimensions()
		this.setupDynamicListeners()

		/**
		 * Listen to location changes, when you change the url
		 ** NOTE: For testing purposes this function is defined like this
		 ** A lot of stuff taken from here: https://searchfox.org/mozilla-central/source/browser/components/shell/HeadlessShell.sys.mjs#57
		 ** and here: https://searchfox.org/mozilla-central/source/devtools/server/actors/resources/parent-process-document-event.js#98
		 ** and here: https://searchfox.org/mozilla-central/source/browser/components/asrouter/modules/ASRouterTriggerListeners.sys.mjs#393
		 ** and here also: https://searchfox.org/mozilla-central/source/browser/components/tabbrowser/content/tabbrowser.js#7181
		 */
		this.tabProgressListener.onLocationChange = async function (
			aBrowser,
			webProgress,
			_request,
			_uri, // location
			flags
		) {
			// Some websites trigger redirect events after they finish loading even
			// though the location remains the same. This results in onLocationChange
			// events to be fired twice.
			// Also, we don't care about inner-frame navigations
			const isSameDocument = !!(
				flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
			)
			if (!webProgress.isTopLevel || isSameDocument) {
				console.log('Ignoring inner-frame events onLocationChange')
				return
			}

			// Ignore event of other browsers tabs
			if (window.gBrowser.selectedBrowser !== aBrowser) {
				console.info('Ignoring event onLocationChange of browser', aBrowser)
				return
			}
			console.log('🔶onLocationChange!', _uri.spec, arguments)

			const isAbout = _uri.schemeIs('about')
			if (isAbout) {
				console.log('Is about: tab')

				// Ignore the initial about:blank, unless about:blank is requested
				if (_uri.spec == 'about:blank') {
					console.log('onLocationChange: Ignoring about:blank', arguments)
					if (
						!aBrowser.contentPrincipal ||
						aBrowser.contentPrincipal.isNullPrincipal
					) {
						console.info('Ignoring about:blank null principal')
						// For an about:blank with a null principal we want to ignore it
						return
					}
					// If it's not a null principal, there may be content loaded into it,
					// so we proceed as normal
					// TODO: Handle about:blank
				} else if (
					window.AboutNewTab.enabled &&
					_uri.spec == window.AboutNewTab.newTabURL
				) {
					// If it's the new tab and browser.newtab.preload pref is enabled, then the load
					// event will not fire again for the new tab unless it's manually refreshed by the user.
					console.log('about:newtab')
				} else if (_uri.spec.startsWith('about:reader')) {
					// Reader mode should also be loaded as normal
				}

				// If we reach this point, then we should just use the cached color for about: tabs
				// TODO: handle about: tabs cache colors
			}

			// Media documents should always start at 1, and are not affected by prefs.
			const isMedia = aBrowser.isSyntheticDocument
			if (isMedia) {
				console.log('Selected tab is a media document, ignoring screenshot')
				// TODO: handle tabs that will not be painted
				return
			}

			console.log('onLocationChange top level')

			const isLoadingDocument = webProgress.isLoadingDocument
			if (isLoadingDocument) {
				console.log('Waiting for document to stop loading, before screenshot')
				// The DOM load is notified using the frame script
				return
				/*
				const listener = new lazy.ProgressListener(webProgress, {
					resolveWhenStarted: false,
				})
				const navigated = listener.start()
				navigated.finally(() => {
					console.log('navigated finally')
					if (listener.isStarted) {
						listener.stop()
					}
				})
				await navigated
				*/
			}

			if (_uri.hasRef) {
				// If the target URL contains a hash, handle the navigation without redrawing
				console.log('onLocationChange not top level with hash: ' + _uri)
				this.dynamicScreenshot()
				return
			}

			console.log('onLocationChange reached end of function', arguments)
			this.dynamicScreenshot(true)
		}.bind(this)

		window.gBrowser.addTabsProgressListener(
			this.tabProgressListener,
			Ci.nsIWebProgress.NOTIFY_STATE_ALL
		)
		Services.obs.addObserver(this, 'UCJS:WebExtLoaded')

		// Force load
		this.dynamicScreenshot()
	},

	receiveMessage: function (msg) {
		const aTab = msg.target
		console.debug(`[EVENT - ${msg.name}] Mousegeestures.uc.js`, aTab, msg)

		// Ignore if it's not the selected
		if (!this.CANVAS || aTab != gBrowser.selectedBrowser) return

		// Always set the latest dimensions for the tab
		this.setTabBuffer(aTab, 'rect', msg.data.screen)

		switch (msg.name) {
			case 'DynamicTabBar:TabReady': {
				console.log('Tab ready, taking screenshot', msg.data)
				const overrideColor = msg.data.themeColor
				this.dynamicScreenshot(true, overrideColor)
				break
			}

			case 'DynamicTabBar:Scroll': {
				const { scrollY, scrollX, width, height, top, left } = msg.data.screen
				const scrollPosition = scrollY || 0
				this.CANVAS.style.transform = `translateY(-${scrollPosition}px)`
				break
			}
		}
	},

	_debounceScrollRef: null,
	exec: function (win) {
		const { customElements, document, gBrowser } = win
		console.log('EXEC!', this, win, customElements, document, gBrowser, {
			//* this means we are using the same instance that was first created when the browser started
			_isNewInstance: this._isNewInstance,
		})

		const mm = window.messageManager

		this._debounceScrollRef = this.debounce(this.receiveMessage.bind(this), 2)
		mm.addMessageListener('DynamicTabBar:TabReady', this)
		mm.addMessageListener('DynamicTabBar:Scroll', this._debounceScrollRef)
		mm.loadFrameScript(
			'resource://userchromejs/mouseGestures/MGestParent.sys.mjs',
			true
		)
	},

	init: function () {
		this._isNewInstance = false
		if (Services.appinfo.inSafeMode) {
			// Don't you try to skip this, safe mode disables a lot of graphic features and the GPU
			console.log(
				'Browser in safe mode, skipping initialization of DynamicTabBar component'
			)
			return
		}

		window.addEventListener(
			'MozAfterPaint',
			() => {
				if (window.gBrowserInit.delayedStartupFinished) this._init()
				else {
					const delayedStartupFinished = (subject, topic) => {
						if (
							topic == 'browser-delayed-startup-finished' &&
							subject == window
						) {
							Services.obs.removeObserver(delayedStartupFinished, topic)
							this._init()
						}
					}
					Services.obs.addObserver(
						delayedStartupFinished,
						'browser-delayed-startup-finished'
					)
				}
			},
			{ once: true }
		)
	},

	//* destroy() should be called uninit() as any file that is loaded into the browser window scope?
	destroy: function () {
		ChromeUtils.unregisterWindowActor('MGest')
		Services.obs.removeObserver(this, 'UCJS:WebExtLoaded')
		window.gBrowser.removeTabsProgressListener(this.tabProgressListener)
		window.messageManager.removeMessageListener('DynamicTabBar:TabReady', this)
		window.messageManager.removeMessageListener(
			'DynamicTabBar:Scroll',
			this._debounceScrollRef
		)
		window.messageManager.removeDelayedFrameScript(
			'resource://userchromejs/mouseGestures/MGestParent.sys.mjs'
		)
		this._cachedBuffers.clear()
		this._buffers.clear()
		EventTracker.destroy()
		this.initializeElements(true)
		delete UC.MGest
	},
}

UC.MGest.init()
