//Final: import { XPCOMUtils } from 'resource://gre/modules/XPCOMUtils.sys.mjs'
// Testing:
ChromeUtils.importESModule('resource://gre/modules/XPCOMUtils.sys.mjs')

const lazy = {}

ChromeUtils.defineESModuleGetters(lazy, {
	BrowserUtils: 'resource://gre/modules/BrowserUtils.sys.mjs',
	PrivateBrowsingUtils: 'resource://gre/modules/PrivateBrowsingUtils.sys.mjs',
})

// Constants
window.DEBUG_DYNAMIC_TABS = true
const TOOLBOX_ELEMENT = document.getElementById('navigator-toolbox')

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

/**
 * Preferences
 * Defines a getter on a specified object for preference value. The
 * preference is read the first time that the property is accessed,
 * and is thereafter kept up-to-date using a preference observer.
 *
 * @param aObject
 *        The object to define the lazy getter on.
 * @param aName
 *        The name of the getter property to define on aObject.
 * @param aPreference
 *        The name of the preference to read.
 * @param aDefaultPrefValue
 *        The default value to use, if the preference is not defined.
 *        This is the default value of the pref, before applying aTransform.
 * @param aOnUpdate
 *        A function to call upon update. Receives as arguments
 *         `(aPreference, previousValue, newValue)`
 * @param aTransform
 *        An optional function to transform the value.  If provided,
 *        this function receives the new preference value as an argument
 *        and its return value is used by the getter.
 */
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
		// TODO
		// cleanup()
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
	lazy['DYNAMIC_TAB_BAR_BLUR_AMOUNT'],
	lazy['DYNAMIC_TAB_BAR_ENABLED']
)

function addStyles(aCss) {
	const id = 'dynamictabbar-styles'
	let styleElement = document.getElementById(id)
	if (!styleElement) {
		styleElement = document.createElement('style')
		styleElement.setAttribute('type', 'text/css')
		styleElement.id = id
		this.document.head.appendChild(styleElement)
	}
	styleElement.textContent = aCss
}
addStyles(`
#snapshotCanvas {
	position: fixed;
  top: 0;
  left: 0;
  pointer-events: none;
  width: 100vw;
}

/* Remove background and borders of the middle navigation bar */
#navigator-toolboxm, #navigator-toolbox #nav-bar, #navigator-toolbox #PersonalToolbar {
	background: none !important;
	border: none !important;
}
`)

// TODO: This should only be applied on first load and saved in memory

function fullExpandPixelRow(canvas) {
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

	const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
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

	//? DEBUG
	//ctx.putImageData(firstRow, 0, 380)

	// Draw
	ctx.putImageData(imageData, 0, 0)
}

async function dynamicScreenshot() {
	// const browserWinDimensions = document.body.getBoundingClientRect()
	const { width, height } = TOOLBOX_ELEMENT.getBoundingClientRect()
	const rect = new DOMRect(
		0,
		height,
		width,
		document.body.getBoundingClientRect().height - height
	)

	let debugCanvas = document.querySelector('#snapshotCanvas_DEBUG')
	let canvas = document.querySelector('#snapshotCanvas')

	if (!canvas) {
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
			debugCanvas.style.height = rect.height / 4
			debugCanvas.width = width / 4
			debugCanvas.height = height / 4
		}
		canvas = document.createElement('canvas')
		canvas.id = 'snapshotCanvas'
		canvas.imageSmoothingEnabled = false
		canvas.mozOpaque = true

		// Append the canvas to the body or a specific container
		TOOLBOX_ELEMENT.prepend(canvas)
	}

	// update dimensions
	canvas.style.height = rect.height
	canvas.width = width
	canvas.height = height

	// Get the canvas context and draw the snapshot with a blur filter
	const ctx = canvas.getContext('2d')

	const context = await this.browsingContext.currentWindowContext
	if (context.fullscreen) {
		console.log('fullscreen detected, ignoring screenshot')
		return
	}

	const imgBitmap = await context.drawSnapshot(
		rect, // DOMRect
		1, // Scale
		'rgb(255, 255, 255)' // Background (required)
	)

	ctx.drawImage(imgBitmap, 0, 0)
	if (window.DEBUG_DYNAMIC_TABS) {
		debugCanvas.getContext('2d').drawImage(imgBitmap, 0, 0)
	}

	imgBitmap.close()
	console.log('done')

	// Apply pattern if requested
	// Note: when using this pattern method, BLUR FILTER MUST BE DISABLED
	fullExpandPixelRow(canvas)

	// Apply blur
	// TODO: replace with assembly and CSS
}
