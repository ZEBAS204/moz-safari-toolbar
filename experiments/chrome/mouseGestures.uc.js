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
window.DEBUG_DYNAMIC_TABS = true

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
window._DynamicTabsEventTracker = EventTracker

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
const BLUR_TYPES = {
	ACRYLIC: 'acrylic', // 60px
	MICA: 'mica', // 40px
	MICA_ALT: 'mica_alt', // 80px
	TRANSPARENT: 'transparent', // 5px
}

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
		console.log('Updated Security border', newVal, this)
		// TODO
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
const DYNAMIC_TAB_BAR_BLUR_AMOUNT_PREF = 'dynamic.browser.component.blur_amount'
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
			console.error('Updated Blur Amount failed due to canvas element missing!')
		}
	}
)

// idk why but we need to tell lazy to actually work
console.log(
	this.DYNAMIC_TAB_BAR_BLUR_AMOUNT,
	this.DYNAMIC_TAB_BAR_ENABLED,
	this.DYNAMIC_TAB_BAR_STYLE,
	this.DYNAMIC_TAB_BAR_SECURITY_BORDER
)

//* Sidebar compatibility
// TODO: use this to check if sidebar is enabled and change dimensions accordingly
const SIDEBAR_ENABLED_PREF = 'sidebar.revamp'
const IS_SIDEBAR_ENABLED = Services.prefs.getBoolPref(SIDEBAR_ENABLED_PREF)

// TODO: make this object an actual class
UC.MGest = {
	_isNewInstance: true,
	_buffers: new WeakMap(),
	_currentTab: window.gBrowser.selectedTab,
	getDimensions_cache: null,

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
	 * Object containing dimensions:
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
			window.windowUtils.getBoundsWithoutFlushing(window.document.body)

		const { width: TBwidth, height: TBheight } =
			window.windowUtils.getBoundsWithoutFlushing(window.gNavToolbox)

		const TBrect = new DOMRect(0, TBheight, TBwidth, BrowserHeight - TBheight)
		const BrowserRect = new DOMRect( // browser sidebar + browser (if we want to make transparent also the side bar)
			0,
			TBheight,
			BrowserWidth,
			BrowserHeight - TBheight
		)
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
	fullExpandPixelRow: function (canvas, bitmap) {
		const { TBwidth, TBheight } = this.getDimensions()

		const ctx = canvas.getContext('2d', CONTEXT_SETTINGS)
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
			if (j === firstRowData.length) j = 0

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

	CANVAS: window.document.getElementById('snapshotCanvas'),
	dynamicScreenshot: async function (force = false) {
		window.console.time('dynamicScreenshot')
		console.log(`dynamicScreenshot(${force ? 'true' : 'false'})`)
		const { TBwidth, TBheight, ContentRect } = this.getDimensions()

		// update dimensions
		this.CANVAS.width = TBwidth
		this.CANVAS.height = ContentRect.height

		// Todo: check if handling fullscreen is actually needed...
		if (window.fullScreen && window.FullScreen.navToolboxHidden) {
			console.log('fullscreen detected, ignoring screenshot')
			return
		}

		// Since requestAnimationFrame callback is generally triggered
		// before any style flush and layout, we should wait for the
		// second animation frame.
		await new Promise((r) => window.requestAnimationFrame(r))
		Services.tm.dispatchToMainThread(async () => {
			const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)

			if (!force) {
				const _currentTab = this._currentTab
				const imgData = this._buffers.get(_currentTab)
				if (imgData) {
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
			this.firstLoadScreenshot()

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
			if (window.DEBUG_DYNAMIC_TABS) {
				this.debugCanvas
					.getContext('2d', { alpha: false })
					.drawImage(imgBitmap, 0, 0)
			}

			imgBitmap.close()
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
				// Save image data as buffer
				this._buffers.set(window.gBrowser.selectedTab, saveImageBuffer)
			})
		})
	},

	firstLoadScreenshot: async function () {
		window.console.time('firstLoadScreenshot')
		const { TBrect } = this.getDimensions()
		const scale = this.getScale()
		const imgBitmap =
			await window.browsingContext.currentWindowGlobal.drawSnapshot(
				TBrect, // DOMRect
				scale, // Scale
				'rgb(255, 255, 255)', // Background (required)
				false // fullViewport
			)

		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)
		ctx.drawImage(imgBitmap, 0, 0)

		imgBitmap.close()

		window.console.timeEnd('firstLoadScreenshot')

		// Apply pattern if requested
		// Note: when using this pattern method, BLUR FILTER MUST BE DISABLED
		// TODO: use Element.animate (https://hacks.mozilla.org/2016/08/animating-like-you-just-dont-care-with-element-animate)
		this.CANVAS.style.transform = 'translateY(0px)'
		this.fullExpandPixelRow(this.CANVAS)
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

	setupDynamicListeners: function () {
		EventTracker.removeAllTrackedEventListeners()

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
				lazy.setTimeout(() => {
					console.log(
						'Tab closed!',
						event,
						{ isInWeakMap: this._buffers.has(this._currentTab) },
						this._buffers
					)
				})
			}
		)

		// TODO: read this
		//! https://searchfox.org/mozilla-central/source/browser/components/tabbrowser/content/tabbrowser.js
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

		this.debugCanvas = window.document.getElementById(debugCanvasID)
		this.CANVAS = window.document.getElementById(canvasID)

		if (remove) {
			this.CANVAS?.remove()
			this.debugCanvas?.remove()
		}
		if (this.CANVAS) return

		const { TBrect, TBwidth, TBheight } = this.getDimensions()
		if (window.DEBUG_DYNAMIC_TABS && !this.debugCanvas) {
			this.debugCanvas = window.document.createElement('canvas')
			this.debugCanvas.id = debugCanvasID
			this.debugCanvas.imageSmoothingEnabled = false
			this.debugCanvas.mozOpaque = true
			this.debugCanvas.style.position = 'fixed'
			this.debugCanvas.style.bottom = '0'
			this.debugCanvas.style.right = '0'
			this.debugCanvas.style.pointerEvents = 'none'
			this.debugCanvas.style.width = 'calc(100vw/4)'
			this.debugCanvas.style.height = TBrect.height / 4
			this.debugCanvas.width = TBwidth / 4
			this.debugCanvas.height = TBheight / 4
			window.document.body.appendChild(this.debugCanvas)
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
		const shouldHideSecurityBorder = this.DYNAMIC_TAB_BAR_SECURITY_BORDER

		addStyles(`
      #snapshotCanvas {
        position: fixed;
        top: 0;
        left: 0;
        pointer-events: none;
        width: 100vw;
        will-change: transform;
        z-index: -1;
      }

      /* Remove background and borders of the middle navigation bar */
			#${tb} #nav-bar, #${tb} #PersonalToolbar {
				background: none !important;
				border: none !important;
			}

			#${tb} {
				background: none !important;
				${shouldHideSecurityBorder ? 'border: none !important;' : ''}
			}
      `)
	},

	/**
	 * Keeps track of the tab listeners so we can remove them later
	 */
	tabProgressListener: {},
	_init: function () {
		console.log('INIT!')

		this.initializeElements()
		this.getDimensions()
		this.setupDynamicListeners()
		Services.obs.addObserver(this, 'UCJS:WebExtLoaded')

		/**
		 * Listen to location changes, when you change the url
		 ** NOTE: For testing purposes this function is defined like this
		 */
		this.tabProgressListener.onLocationChange = function (
			aBrowser,
			webProgress,
			_request,
			_uri,
			flags
		) {
			if (window.gBrowser.selectedBrowser !== aBrowser) {
				console.log(
					'Ignoring event onLocationChange of browser',
					aBrowser,
					webProgress,
					_request,
					_uri,
					flags
				)
				return
			}

			// Some websites trigger redirect events after they finish loading even
			// though the location remains the same. This results in onLocationChange
			// events to be fired twice.
			const isSameDocument = !!(
				flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
			)
			const isLoadingDocument = webProgress.isLoadingDocument

			if (webProgress.isTopLevel && !isSameDocument) {
				console.log(
					'onLocationChange',
					aBrowser,
					webProgress,
					_request,
					_uri,
					flags
				)
				//if (isLoadingwindow.document) await new webProgress.addProgressListener()
				// FIXME: executed multiple times, check if there's a property after DOMCONTENTLOADED
				this.dynamicScreenshot(true)
				//window.gBrowser.removeTabsProgressListener(tabProgressListener) //unregister at first call
			}
			if (_uri.hasRef) {
				// If the target URL contains a hash, handle the navigation without redrawing the buffer
				console.log('onLocationChange not top level with hash: ' + _uri)
				this.dynamicScreenshot()
				return
			}

			// when changing page without reloading the page, eg NextJS
			console.log('onLocationChange not top level')
			this.dynamicScreenshot(true)
		}.bind(this)

		window.gBrowser.addTabsProgressListener(this.tabProgressListener, {
			waitForExplicitStart: true,
		})
	},

	receiveMessage: function (msg) {
		console.log(`[EVENT - ${msg.name}] Mousegeestures.uc.js`, msg)
		if (!this.CANVAS) return

		switch (msg.name) {
			case 'DynamicTabBar:TabReady':
				// Do something
				break

			case 'DynamicTabBar:Scroll':
				const { scrollY, scrollX, width, height, top, left } = msg.data.screen
				const scrollPosition = scrollY || 0
				this.CANVAS.style.transform = `translateY(-${scrollPosition}px)`
				break
		}
	},

	_debounceScrollRef: null,
	exec: function (win) {
		const { customElements, document, gBrowser } = win
		console.log('EXEC!', win, customElements, document, gBrowser, {
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
		if (Services.appinfo.inSafeMode) return

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
		// TODO: remove canvas and other elements that were created
		EventTracker.destroy()

		this.initializeElements(true)
		delete UC.MGest
	},
}

UC.MGest.init()
