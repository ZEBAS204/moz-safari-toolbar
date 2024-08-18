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
	imageSmoothingEnabled: false,
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

	_tabProcessingQueue: new WeakMap(),
	getDimensions_cache: null,

	_currentTab: window.gBrowser.selectedTab,
	_isContextLost: false,
	CANVAS: window.document.getElementById('snapshotCanvas'),

	/**
	 * @typedef {Object} BufferData
	 * @property {ImageData} [imgData] - The image data associated with the buffer.
	 * @property {boolean} [isRectCrop] - If the rect dimensions where cropped
	 * @property {Object} [rect] - The rectangle defining the area of screenshot.
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
	 *   BrowserWidth: number,
	 *   BrowserHeight: number,
	 *   TBrect: DOMRect,
	 *   TBwidth: number,
	 *   TBheight: number
	 * }}
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

		const {
			x: xContentOffset,
			y: yContentOffset,
			width: contentWidth,
		} = window.gBrowser.selectedBrowser.getBoundingClientRect()

		const TBrect = new DOMRect(0, 0, contentWidth, TBheight)

		this.getDimensions_cache = {
			BrowserWidth,
			BrowserHeight,
			TBrect,
			TBwidth,
			TBheight,
			contentWidth,
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

	fetchDimensions: function (aBrowser) {
		return new Promise((resolve, reject) => {
			console.log('fetchDimensions promise')

			const mm = aBrowser.messageManager

			const timer = lazy.setTimeout(() => {
				console.info('fetchDimensions timeout')
				mm.removeMessageListener(
					'DynamicTabBar:Dimensions',
					handleFetchDimensionsEvent
				)
				reject('fetchDimensions timeout')
			}, 3000)

			function handleFetchDimensionsEvent(msg) {
				lazy.clearTimeout(timer)
				const dimensions = msg.data.screen

				// Clean up the event listener
				mm.removeMessageListener(
					'DynamicTabBar:Dimensions',
					handleFetchDimensionsEvent
				)

				if (dimensions) return resolve(dimensions)
				reject('fetchDimensions Invalid dimensions data')
			}

			mm.addMessageListener(
				'DynamicTabBar:Dimensions',
				handleFetchDimensionsEvent
			)
			// Send a message to the content script
			gBrowser.selectedBrowser.messageManager.sendAsyncMessage(
				'DynamicTabBar:FetchDimensions'
			)
		})
	},

	fetchFullPageBounds: async function (aBrowser) {
		const dimensions = await this.fetchDimensions(aBrowser)
		if (!dimensions) return null

		this.setTabBuffer(aBrowser, 'rect', dimensions)
		return dimensions
	},

	// TODO: MIGRATE to webassembly, jankiness is produced by this calculation
	fullExpandPixelRow: function (bitmap, ctxCANVAS) {
		const { TBwidth, TBheight, xContentOffset, contentWidth } =
			this.getDimensions()

		const canvas = new OffscreenCanvas(TBwidth, TBheight)
		const ctx = canvas.getContext('2d', CONTEXT_SETTINGS)
		ctx.drawImage(bitmap, 0, 0)

		const START_HEIGHT = 0
		const PIXEL_ROWS_TO_USE = 4
		let firstRow = ctx.getImageData(0, START_HEIGHT, contentWidth, TBheight)
		let data = firstRow.data

		// Make a seamless verticall pattern with the first 4 pixel rows
		// Remember Uint8ClampedArray takes a RGBA array [r,g,b,a] for a single bit,
		// so we have to create an array contanining the tab bar dimensions * 4
		const iLength = data.length
		const firstRowDatalength = contentWidth * PIXEL_ROWS_TO_USE * 4 //firstRowData.length
		const skipPaintedRow = firstRowDatalength
		for (let i = skipPaintedRow, j = 0; i < iLength; i += 4, j += 4) {
			if (j == firstRowDatalength) j = 0

			data[i] = data[j] // red
			data[i + 1] = data[j + 1] // green
			data[i + 2] = data[j + 2] // blue
			data[i + 3] = 255 // alpha
		}

		// Draw
		ctxCANVAS.putImageData(firstRow, xContentOffset, 0)
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

		const {
			BrowserHeight,
			BrowserWidth,
			TBheight: ToolbarHeight,
		} = this.getDimensions()
		const scale = this.getScale()

		let cropped = false
		let width = rect.width * scale
		let height = rect.height * scale

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
			//* TEMP FIX
			//* Use the total screen width instead the rect width, this is because absolute/relative positioning may break the screenshot dimensions
			width = BrowserWidth
			cropped = true
		}

		if (height <= BrowserHeight) {
			console.info(
				'[OPTIMIZATION] Rect fit only toolbar, only taking screenshot of toolbar height'
			)
			height = ToolbarHeight
			rect.skipSetDimensions = true
		} else if (height >= BrowserHeight) {
			// TODO: add a tiny space to account for infinite scrolling
			console.info(
				'[OPTIMIZATION] Removing window - toolbar height of screenshot'
			)
			height = Math.max(height - BrowserHeight + ToolbarHeight * 2, 0)
		}

		Object.assign(rect, {
			width: Math.floor(width / scale),
			height: Math.floor(height / scale),
			right: rect.left + rect.width,
			bottom: rect.top + rect.height,
		})

		// FIXME: do this in a single call and stop writting spaguetti code
		Object.assign(rect, {
			// width = Math.floor(width / rect.devicePixelRatio)
			left: Math.round(rect.left),
			right: Math.round(rect.right),
			top: Math.round(rect.top),
			bottom: Math.round(rect.bottom),
			width: Math.round(rect.right - rect.left),
			height: Math.round(rect.bottom - rect.top),
		})

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
		let rect = buffer?.rect
		if (!rect) rect = await this.fetchFullPageBounds(aTab)

		// Reduce the amount of memory used by the canvas
		const region = this.cropScreenshotRectIfNeeded(rect, aTab)
		const scale = this.getScale()

		const browsingContext = aTab.browsingContext
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)

		console.info(
			'Setting canvas region\nwidthxheight',
			[region?.width, region?.height],
			region
		)

		if (!region.skipSetDimensions) {
			Object.assign(this.CANVAS, {
				width: region.width * scale,
				height: region.height * scale,
			})
		} else {
			console.info(
				'Ignoring draw request as content is only toolbar height\n',
				'Skipping canvas set dimensions'
			)
			return 1
		}

		const snapshotSize = Math.floor(MAX_SNAPSHOT_DIMENSION * scale)

		let totalDrawTime = window.performance.now()

		// Add offset so start after the Toolbar region paint
		// TODO: change offset dynamically
		const { xContentOffset, yContentOffset } = this.getDimensions()

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
				let startDrawTime = window.performance.now()
				console.time('DynamicTabBar:DrawTime')

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
					scale,
					'rgb(255,255,255)'
				)

				//* Debug
				let endSnapshotTime = window.performance.now()
				console.log(`Snapshot took: ${endSnapshotTime - startSnapshotTime} ms`)

				let left = Math.floor((startLeft - region.left) * scale)
				let top = Math.floor((startTop - region.top) * scale)
				ctx.drawImage(
					snapshot,
					left - (left % snapshotSize) + xContentOffset, // Start drawing after the sidebar (if any)
					top - (top % snapshotSize) + yContentOffset, // Start drawing after the toolbar height
					Math.floor(width * scale),
					Math.floor(height * scale)
				)
				snapshot.close()

				//* Debug
				let startDrawTimeEnd = window.performance.now()
				console.log(`Draw Time took: ${startDrawTimeEnd - startDrawTime}ms`)
			}
		}

		//* Debug
		let totalDrawTimeEnd = window.performance.now()
		console.log(
			`Processing all snapshots took: ${totalDrawTimeEnd - totalDrawTime}ms`
		)
		return 1
	},

	dynamicScreenshot: async function () {
		const tabRef = gBrowser.selectedBrowser

		if (this._tabProcessingQueue.has(tabRef)) {
			console.log('Ignoring draw request, tab already on queue', tabRef)
			return
		}

		console.log('Adding tab to processing queue', tabRef, arguments)
		//* Create an AbortController
		//* https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal#implementing_an_abortable_api
		// const abortController = new AbortController()
		// const { signal } = abortController
		// this._tabProcessingQueue.set(tabRef, 'abortSignal', signal)
		this._tabProcessingQueue.set(tabRef, 'processing')

		this._dynamicScreenshot(...arguments).finally(() => {
			console.log('Removing tab of processing queue:', tabRef)
			this._tabProcessingQueue.delete(tabRef)
		})
	},

	_dynamicScreenshot: async function (force = false, overrideColor = null) {
		window.console.time('dynamicScreenshot')
		console.log(`dynamicScreenshot(${force ? 'true' : 'false'})`, overrideColor)

		if (window.fullScreen && window.FullScreen.navToolboxHidden) {
			// Todo: check if handling fullscreen is actually needed...
			console.log('fullscreen detected, ignoring screenshot')
			return
		}

		await new Promise((r) => window.requestAnimationFrame(r))
		// Defer paint to the next tick of the event loop since
		//*Services.tm.dispatchToMainThread(async () => {
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)

		const _currentTab = gBrowser.selectedBrowser
		const savedBuffer = this._buffers.get(_currentTab)
		if (!force) {
			if (savedBuffer?.imgData) {
				// update dimensions
				if (!savedBuffer.rect.skipSetDimensions) {
					const scale = this.getScale()
					Object.assign(this.CANVAS, {
						width: savedBuffer.rect.width * scale,
						height: savedBuffer.rect.height * scale,
					})
				} else {
					console.info('Skipping canvas set dimensions')
				}

				const { imgData } = savedBuffer
				console.log(
					'Using saved buffer image data of tab',
					_currentTab,
					imgData
				)
				window.requestAnimationFrame(() => ctx.putImageData(imgData, 0, 0))
				window.console.timeEnd('dynamicScreenshot')
				return
			}
		}

		// Apply pattern if requested
		this.firstLoadScreenshot(_currentTab, overrideColor)
		this.setTabBuffer(_currentTab, 'isRectCrop', false)

		await this.processSnapshot(_currentTab)
		window.console.timeEnd('dynamicScreenshot')

		// Wait till the canvas finish painting
		lazy.setTimeout(() => {
			const saveImageBuffer = ctx.getImageData(
				0,
				0,
				this.CANVAS.width,
				this.CANVAS.height
			)
			console.log('creating buffer for tab:', _currentTab, saveImageBuffer)
			this.setTabBuffer(_currentTab, 'imgData', saveImageBuffer)
		})
	},

	firstLoadScreenshot: async function (aBrowser, overrideColor = null) {
		window.console.time('firstLoadScreenshot')
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)
		const { TBrect, TBheight } = this.getDimensions()

		// TODO: sanitize overrideColor
		if (overrideColor) {
			console.info('Using theme color override:', overrideColor)
			ctx.fillStyle = overrideColor // Set the color you want for the rectangle
			ctx.fillRect(0, 0, this.CANVAS.width, TBheight)

			window.console.timeEnd('firstLoadScreenshot')
			return
		}

		const scale = this.getScale()
		const context = aBrowser.browsingContext.currentWindowGlobal
		let imgBitmap = await context.drawSnapshot(
			TBrect,
			scale,
			'rgb(255,255,255)'
		)

		this.CANVAS.style.transform = 'translateY(0px)'
		this.fullExpandPixelRow(imgBitmap, ctx)
		imgBitmap.close()

		window.console.timeEnd('firstLoadScreenshot')
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
			'TabClose',
			(event) => {
				console.log('Tab closed!', event)
				this._buffers.delete(event.target.linkedBrowser)
			}
		)

		EventTracker.addTrackedEventListener(
			window.gBrowser.tabContainer,
			'TabOpen',
			(event) => {
				console.log('Tab created!', event)

				// Pre-alocate the buffer to avoid changing sizes
				// TODO: do this in a single call
				this.setTabBuffer(event.target.linkedBrowser, 'rect', {
					scrollY: 0,
					scrollX: 0,
					left: 0,
					right: 0,
					top: 0,
					bottom: 0,
					width: 0,
					height: 0,
					isRectCrop: false,
				})
				this.setTabBuffer(event.target.linkedBrowser, 'imgData', null)
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
					this._buffers.delete(event.target.linkedBrowser)
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
				this._isContextLost = true
				console.log('Canvas contextlost!', event)
				this.CANVAS.addEventListener('contextrestored', (event) => {
					// TODO: handle contextlost event
					console.log('Canvas context restored!', event)
					this._isContextLost = false
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

	//* eg. UC.MGest.TEST_drawBoxFormRect(UC.MGest.getDimensions(true).TBrect)
	TEST_drawBoxFormRect: function (rect, color) {
		const box = window.document.createElement('div')

		if (!color) {
			let r = Math.floor(Math.random() * 256)
			let g = Math.floor(Math.random() * 256)
			let b = Math.floor(Math.random() * 256)
			color = `rgba(${r}, ${g}, ${b}, 0.5)`
		}

		box.style.position = 'absolute'
		box.style.backgroundColor = color
		box.style.border = '1px solid cyan' // Optional border for visibility

		box.style.left = `${rect.left}px`
		box.style.top = `${rect.top}px`
		box.style.width = `${rect.width}px`
		box.style.height = `${rect.height}px`

		box.addEventListener('click', () => box.remove())
		window.document.body.appendChild(box)
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
		const canvasID = 'snapshotCanvas'
		this.CANVAS = window.document.getElementById(canvasID)

		if (remove) this.CANVAS?.remove()
		if (this.CANVAS) return

		const { TBheight, TBwidth } = this.getDimensions()
		this.CANVAS = window.gBrowser.selectedBrowser.ownerDocument.createElementNS(
			'http://www.w3.org/1999/xhtml',
			'canvas'
		)
		this.CANVAS.width = TBwidth
		this.CANVAS.height = TBheight
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
        will-change: transform;
        z-index: -1;
				transform-origin: center top 0;
				image-rendering: optimizespeed;
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

		const DEFAULT_THEME_COLOR_OVERRIDE = false
		const DEFAULT_THEME_COLOR_OVERRIDE_PREF =
			'dynamic.browser.component.use_theme_color'
		XPCOMUtils.defineLazyPreferenceGetter(
			this,
			'THEME_COLOR_OVERRIDE',
			DEFAULT_THEME_COLOR_OVERRIDE_PREF,
			DEFAULT_THEME_COLOR_OVERRIDE
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
				window.requestAnimationFrame(() => {
					this.CANVAS.style.transform = `translateY(-${scrollPosition}px)`
				})
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
		EventTracker.destroy()
		this.initializeElements(true)
		delete UC.MGest
	},
}

UC.MGest.init()
