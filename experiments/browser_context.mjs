//! This file was migrated to chrome/mouseGestures.uc.js, it will be removed later

//Final: import { XPCOMUtils } from 'resource://gre/modules/XPCOMUtils.sys.mjs'
// Testing:
ChromeUtils.importESModule('resource://gre/modules/XPCOMUtils.sys.mjs')

//*already present
//const lazy = {}

ChromeUtils.defineESModuleGetters(lazy, {
	BrowserUtils: 'resource://gre/modules/BrowserUtils.sys.mjs',
	PrivateBrowsingUtils: 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs',
})

// Constants
//* Canvas dimensions handling example: https://searchfox.org/mozilla-central/source/remote/shared/Capture.sys.mjs
const MAX_CANVAS_DIMENSION = 32767
const MAX_CANVAS_AREA = 472907776
window.DEBUG_DYNAMIC_TABS = true

const IS_PRIVATE_WINDOW = lazy.PrivateBrowsingUtils.isWindowPrivate(
	browser.ownerGlobal
)
const BLUR_TYPES = {
	ACRYLIC: 'acrylic', // 60px
	MICA: 'mica', // 40px
	MICA_ALT: 'mica_alt', // 80px
	TRANSPARENT: 'transparent', // 5px
}
const DEFAULT_BLUR_AMOUNT = 60
const DEFAULT_BLUR_TYPE = BLUR_TYPES.ACRYLIC

const DYNAMIC_TAB_BAR_ENABLED_PREF = 'dynamic.browser.component.enabled'
XPCOMUtils.defineLazyPreferenceGetter(
	lazy,
	'DYNAMIC_TAB_BAR_ENABLED',
	DYNAMIC_TAB_BAR_ENABLED_PREF,
	true,
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

const DYNAMIC_TAB_BAR_STYLE_PREF = 'dynamic.browser.component.blur_style'
XPCOMUtils.defineLazyPreferenceGetter(
	lazy,
	'DYNAMIC_TAB_BAR_STYLE',
	DYNAMIC_TAB_BAR_STYLE_PREF,
	DEFAULT_BLUR_TYPE,
	function onBlurTypeUpdate(_pref, _prevVal, newVal) {
		console.log('Updated Blur Type', newVal)
		// TODO
	}
)

const DYNAMIC_TAB_BAR_BLUR_AMOUNT_PREF = 'dynamic.browser.component.blur_amount'
XPCOMUtils.defineLazyPreferenceGetter(
	lazy,
	'DYNAMIC_TAB_BAR_BLUR_AMOUNT',
	DYNAMIC_TAB_BAR_BLUR_AMOUNT_PREF,
	DEFAULT_BLUR_AMOUNT,
	function onBlurAmountUpdate(_pref, _prevVal, newVal) {
		// TODO validate new val
		// TODO cannot be negative
		const canvas = document.getElementById('snapshotCanvas')
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
	lazy['DYNAMIC_TAB_BAR_BLUR_AMOUNT'],
	lazy['DYNAMIC_TAB_BAR_ENABLED'],
	lazy['DYNAMIC_TAB_BAR_STYLE']
)

function addStyles(aCss, add) {
	const id = 'dynamictabbar-styles'
	let styleElement = document.getElementById(id)
	if (!styleElement) {
		styleElement = document.createElement('style')
		styleElement.setAttribute('type', 'text/css')
		styleElement.id = id
		this.document.head.appendChild(styleElement)
	}
	if (add) styleElement.textContent += aCss
	else styleElement.textContent = aCss
}
;(() => {
	const id = window.gNavToolbox.id || '#navigator-toolbox'
	const shouldHideSecurityBorder = false // TODO: add option

	addStyles(`
#snapshotCanvas {
	position: fixed;
  top: 0;
  left: 0;
  pointer-events: none;
  width: 100vw;
	will-change: transform;
	/*transition: transform 0.1s;*/
	z-index: -1;
}

/* Remove background and borders of the middle navigation bar */
#${id} #nav-bar, #${id} #PersonalToolbar {
	background: none !important;
	border: none !important;
}

#${id} {
	background: none !important;
	${shouldHideSecurityBorder ? 'border: none !important;' : ''}
}
`)
})()

let getDimensions_cache = null
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
function getDimensions(reflow = false) {
	if (!reflow && getDimensions_cache) return getDimensions_cache

	const { height: BrowserHeight, width: BrowserWidth } =
		window.windowUtils.getBoundsWithoutFlushing(document.body)

	const { width: TBwidth, height: TBheight } =
		window.windowUtils.getBoundsWithoutFlushing(window.gNavToolbox)

	const TBrect = new DOMRect(0, TBheight, TBwidth, BrowserHeight - TBheight)
	//* const ContentRect = new DOMRect(0, TBheight, BrowserWidth, BrowserHeight - TBheight)

	getDimensions_cache = {
		//* ContentRect,
		BrowserWidth,
		BrowserHeight,
		TBrect,
		TBwidth,
		TBheight,
	}
	return getDimensions_cache
}
getDimensions()

// FIXME: MIGRATE to webassembly, jankiness is produced by this calculation
// TODO: avoid using the image data from canvas, use the raw bitmap directly
// TODO: use the first bitmap as reference instead of re-getting the image data from the canvas, TBheight defines the amount of loops to perform
function fullExpandPixelRow(canvas, bitmap) {
	const { TBwidth, TBheight } = getDimensions()

	const ctx = canvas.getContext('2d')
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
}

let CANVAS = document.getElementById('snapshotCanvas')
async function dynamicScreenshot() {
	const { TBrect, TBwidth, TBheight } = getDimensions()

	let debugCanvas = document.getElementById('snapshotCanvas_DEBUG')
	CANVAS = document.getElementById('snapshotCanvas')

	if (!CANVAS) {
		if (window.DEBUG_DYNAMIC_TABS) {
			debugCanvas = document.createElement('canvas')
			debugCanvas.id = 'snapshotCanvas_DEBUG'
			debugCanvas.imageSmoothingEnabled = false
			debugCanvas.mozOpaque = true
			debugCanvas.style.position = 'fixed'
			debugCanvas.style.bottom = '0'
			debugCanvas.style.right = '0'
			debugCanvas.style.pointerEvents = 'none'
			document.body.appendChild(debugCanvas)
			debugCanvas.style.width = 'calc(100vw/4)'
			debugCanvas.style.height = TBrect.height / 4
			debugCanvas.width = TBwidth / 4
			debugCanvas.height = TBheight / 4
		}
		CANVAS = document.createElement('canvas')
		CANVAS.id = 'snapshotCanvas'
		CANVAS.imageSmoothingEnabled = false
		CANVAS.mozOpaque = true

		// Apply blur
		CANVAS.style.filter = `blur(${lazy['DYNAMIC_TAB_BAR_BLUR_AMOUNT']}px)`

		// Append the canvas to the body or a specific container
		//window.gNavToolbox.prepend(CANVAS)
		window.gNavToolbox.parentNode.insertBefore(CANVAS, window.gNavToolbox)
	}

	// update dimensions
	CANVAS.style.height = TBrect.height
	CANVAS.width = TBwidth
	CANVAS.height = TBrect.height

	if (window.fullScreen) {
		// FIXME: fails, find another way to check for fullscreen
		console.log('fullscreen detected, ignoring screenshot')
		return
	}

	// Since requestAnimationFrame callback is generally triggered
	// before any style flush and layout, we should wait for the
	// second animation frame.
	requestAnimationFrame(() => {
		Services.tm.dispatchToMainThread(async () => {
			// Apply pattern if requested
			firstLoadScreenshot()

			// Get the canvas context and draw the snapshot with a blur filter
			const ctx = CANVAS.getContext('2d')
			const scale = window.devicePixelRatio
			const context = await this.browsingContext.currentWindowContext // or window.gBrowser.selectedTab.linkedBrowser.browsingContext.currentWindowContext
			const imgBitmap = await context.drawSnapshot(
				TBrect, // DOMRect
				scale, // Scale
				'rgb(255, 255, 255)' // Background (required)
			)

			ctx.drawImage(imgBitmap, 0, TBheight) // start draw under the toolbar image
			if (window.DEBUG_DYNAMIC_TABS) {
				debugCanvas.getContext('2d').drawImage(imgBitmap, 0, 0)
			}
			imgBitmap.close()
			console.log('done')

			// Apply blur
			// TODO: replace with assembly and CSS
		})
	})
}

async function firstLoadScreenshot() {
	const { TBrect } = getDimensions()
	const context = await this.browsingContext.currentWindowContext
	const scale = window.devicePixelRatio
	const imgBitmap = await context.drawSnapshot(
		TBrect, // DOMRect
		scale, // Scale
		'rgb(255, 255, 255)' // Background (required)
	)

	const ctx = CANVAS.getContext('2d')
	ctx.drawImage(imgBitmap, 0, 0)

	imgBitmap.close()
	console.log('done: first load screenshot')

	// Apply pattern if requested
	// Note: when using this pattern method, BLUR FILTER MUST BE DISABLED
	// TODO: use Element.animate (https://hacks.mozilla.org/2016/08/animating-like-you-just-dont-care-with-element-animate)
	CANVAS.style.transform = 'translateY(0px)'
	fullExpandPixelRow(CANVAS)
}

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
		if (!element) return

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
}

function setupDynamicListeners() {
	EventTracker.removeAllTrackedEventListeners()

	EventTracker.addTrackedEventListener(
		window.gNavToolbox,
		'toolbarvisibilitychange', // To check the whole toolbar, use toolbarvisibilitychange
		(event) => {
			// Since the bookmarks toolbar doesn't affect the canvas, we only need to listen to the Menu Bar activation
			console.log('toolbarvisibilitychange', event)
			// Force dimensions reflow
			getDimensions(true)
			dynamicScreenshot()
		}
	)

	EventTracker.addTrackedEventListener(
		gBrowser.tabContainer,
		'TabClose',
		(event) => {
			// console.log('Tab closed!', event)
			// TODO: handle stuff removal
		}
	)

	/*
		window.gBrowser.tabpanels.addEventListener('select', (event) => {
			if (event.target == this.tabpanels) {
				// Update selected browser
				//this.updateCurrentBrowser()
				gBrowser.selectedBrowser //* ---> <browser>
			}
		})
	*/
	// TODO: read this
	//! https://searchfox.org/mozilla-central/source/browser/components/tabbrowser/content/tabbrowser.js

	EventTracker.addTrackedEventListener(
		gBrowser.tabContainer,
		'TabSelect',
		(event) => {
			console.log('New tab selected', event)
			// FIXME: should wait until the first content paint
			dynamicScreenshot()

			//! NOT WORKING
			window.gBrowser.selectedBrowser.browsingContext.topFrameElement.addEventListener(
				'MozAfterPaint',
				() => {
					console.log('loaded!')
				},
				{
					once: true,
				}
			)
		}
	)

	EventTracker.addTrackedEventListener(
		gBrowser.tabContainer,
		'oop-browser-crashed',
		(event) => {
			if (event.isTopFrame) {
				console.log('Tab crashed, discarting buffers!', event)
			}
		}
	)
}
setupDynamicListeners()

/**
 * Listen to location changes, when you change the url
 */
const tabProgressListener = {
	onLocationChange(aBrowser) {
		if (window.gBrowser.selectedBrowser == aBrowser) {
			console.log('onLocationChange', aBrowser, this)

			// FIXME: executed multiple times, check if there's a property after DOMCONTENTLOADED
			dynamicScreenshot()

			//window.gBrowser.removeTabsProgressListener(tabProgressListener) //unregister at first call
		} else {
			console.log('Ignoring event of browser', aBrowser)
		}
	},
}
window.gBrowser.addTabsProgressListener(tabProgressListener)

/*
 *
 *
 *
 *
 *
 * TESTING FUNCTIONS
 */
function TEST_createScrollSlider() {
	// Create slider container and slider elements
	let sliderContainer = document.getElementById('dynamic-sliderContainer')
	let slider = document.getElementById('dynamic-sliderContainer-input')
	let sliderValue = document.getElementById('dynamic-sliderContainer-value')
	let takeScreenshotButton = document.getElementById(
		'dynamic-sliderContainer-screenshotBTN'
	)
	if (!sliderContainer) {
		sliderContainer = document.createElement('div')
		sliderContainer.id = 'dynamic-sliderContainer'
		sliderContainer.style.width = '100%' // Adjust width as needed
		sliderContainer.style.maxWidth = '10vw' // Max width for better responsiveness
		sliderContainer.style.textAlign = 'center'
		sliderContainer.style.left = '5px'
		sliderContainer.style.bottom = '5px'
		sliderContainer.style.position = 'fixed'

		slider = document.createElement('input')
		slider.id = 'dynamic-sliderContainer-input'
		slider.type = 'range'
		slider.min = 0
		slider.step = 1

		takeScreenshotButton = document.createElement('button')
		takeScreenshotButton.textContent = 'Take screenshot'
		takeScreenshotButton.id = 'dynamic-sliderContainer-screenshotBTN'
		takeScreenshotButton.addEventListener('click', () => {
			dynamicScreenshot()
		})

		// Get the height of the document body and set as max value for the slider
		const bodyHeight = document.body.getBoundingClientRect().height
		slider.max = bodyHeight

		// Display current value of the slider
		sliderValue = document.createElement('div')
		sliderValue.id = 'dynamic-sliderContainer-value'
		sliderValue.textContent = '0'

		const blurSlider = document.createElement('input')
		blurSlider.type = 'range'
		blurSlider.min = 0

		// Append slider and value elements to the container
		sliderContainer.appendChild(blurSlider)
		sliderContainer.appendChild(slider)
		sliderContainer.appendChild(sliderValue)
		sliderContainer.appendChild(takeScreenshotButton)

		// Append container to the document body
		document.body.appendChild(sliderContainer)

		// Add blur slider
		blurSlider.addEventListener('input', () => {
			CANVAS.style.filter = `blur(${blurSlider.value}px)`
		})
	}

	// Return an object with references to slider and listeners
	return {
		slider,
		sliderValue,
	}
}

function TEST_setupScrollEvents() {
	// Call the function to create the slider
	if (document.getElementById('dynamic-sliderContainer')) {
		document.getElementById('dynamic-sliderContainer').remove()
	}
	const { slider, sliderValue } = TEST_createScrollSlider()

	const changeListener = () => {
		if (CANVAS) {
			const value = slider.value
			sliderValue.textContent = value
			CANVAS.style.transform = `translateY(-${value}px)`
			//console.log('Slider value changed to:', value)
		}
	}

	// Re-add them
	slider.addEventListener('input', changeListener)
}
TEST_setupScrollEvents()
