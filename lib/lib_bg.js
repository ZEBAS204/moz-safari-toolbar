// PLACEHOLDER
// TODO: instead of using base64 encoded image, just export and use the raw BMP bits from the canvas
// NOTE: after decompression Jpeg will use roughly the same memory as a bitmap so there's no reason to not use Bitmaps
// TODO: check zune-imageprocs for low level image processing
/*
let wasm
function __wbg_set_wasm(val) {
	wasm = val
}

try {
	wasm_lib = chrome.extension.getURL('./lib_bg.wasm')
	__wbg_set_wasm(wasm_lib)
} catch (err) {
	console.error('[SW] WASM registration failed!', err)
	self.postMessage({
		type: 'error',
		message: 'WASM registration failed',
		stack: err,
	})
}
*/

/**
 * @param {Object} obj
 * @param {string} obj.data Base64 enconded string
 * @param {number} obj.blurRadius  {blurR} The amount of passes that will be used when creating the blur
 * @return {String} Base64 encoded image with blur applied
 */
/*
self.onmessage = ({ data, blurRadius = 5 }) => {
	try {
		console.log('Data to worker:', data)
		// const result = wasm_lib(data, blurRadius)

		const result = 'AAA'
		// Return base 64 blurred
		self.postMessage(result)
	} catch (error) {
		console.error('[SW] Error during message handling:', error)
		self.postMessage({
			type: 'error',
			message: error.message,
			stack: error.stack,
		})
		self.terminate()
	}
}

self.onerror = (error) => {
	console.error('[SW] Worker error!', error)
	self.postMessage({
		type: 'error',
		message: error.message,
		stack: error.error ? error.error.stack : null,
	})
}

self.addEventListener('unhandledrejection', function (event) {
	console.error('[SW] Worker unhandled rejection error!', error)
	self.postMessage({
		type: 'error',
		message: 'unhandled promise rejection',
		stack: event.reason,
	})
	// the event object has two special properties:
	// event.promise - the promise that generated the error
	// event.reason  - the unhandled error object
	throw event.reason
})
*/
