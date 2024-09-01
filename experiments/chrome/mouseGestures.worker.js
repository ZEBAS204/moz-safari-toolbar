/* eslint-env mozilla/chrome-worker */
/**
 * A worker dedicated for canvas manipulation of MGesture
 */
'use strict'

/* global require */
importScripts('resource://gre/modules/workers/require.js')
const PromiseWorker = require('resource://gre/modules/workers/PromiseWorker.js')

const worker = new PromiseWorker.AbstractWorker()
worker.dispatch = function (method, args = []) {
	return Agent[method](...args)
}
worker.postMessage = function (message, ...transfers) {
	self.postMessage(message, ...transfers)
}
worker.log = function () {
	console.log('[WORKER] Log:', ...arguments)
}
worker.close = function () {
	console.log('[WORKER] Closing worker')
	self.close()
}

self.addEventListener('message', (msg) => worker.handleMessage(msg))
self.addEventListener('unhandledrejection', function (error) {
	throw error.reason
})

/**
 * This loads the WebAssembly code
 */
const WASM_BINARY_FILE = 'DynamicTabBar-worker.wasm'
let algorithms = {}
async function initWasm() {
	console.log('[WORKER] Loading WASM', WASM_BINARY_FILE)
	let { instance } = await WebAssembly.instantiateStreaming(
		fetch(WASM_BINARY_FILE)
	)

	console.log('[WORKER] INSTANCE:', instance)

	let buffer_address = instance.exports.BUFFER.value
	const MAX_SIZE = instance.exports.get_max_size()

	function instantiateMemory(width, height, band) {
		let memory = new Uint8ClampedArray(
			instance.exports.memory.buffer,
			buffer_address,
			width * height
		)

		for (let i = 0; i < band.length; i++) {
			memory[i] = band[i]
		}
		return memory
	}

	function checkMaxSize(width, height) {
		if (width * height > MAX_SIZE) {
			throw new Error(
				'The image exceeds the maximum size in pixels supported by this WASM function (' +
					MAX_SIZE +
					' pixels)'
			)
		}
	}

	/**
	 * @param {Uint8ClampedArray} band
	 * @param {Number} width
	 * @param {Number} height
	 * @param {Number} radius
	 */
	algorithms.stackWasm = function (band, width, height, radius) {
		checkMaxSize(width, height)
		let memory = instantiateMemory(width, height, band)
		instance.exports.stack_blur(width, height, radius)
		return new Uint8ClampedArray(memory)
	}
}
initWasm()

const CONTEXT_SETTINGS = {
	alpha: false,
	// If true, the canvas must be created, drawn to, and read from entirely on the CPU.
	// Depends on pref gfx.canvas.willreadfrequently.enabled
	willReadFrequently: false,
	imageSmoothingEnabled: false,
}

const Agent = {
	CANVAS: null,
	blurAmount: 32,
	shouldFillGaps: true, // If we should expand the canvas to fill the gaps of the scrollbars and side bar

	init(canvasRef) {
		console.log('[WORKER] INIT OFFSCREEN CANVAS', canvasRef)
		globalThis.CANVAS = canvasRef
		this.CANVAS = globalThis.CANVAS //* TEMP: allow to be accessed through console
		this.ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)
	},

	paintCanvas(_id, bitmap, blurAmount) {
		console.log('[WORKER] Painting canvas', this.CANVAS, ...arguments)

		if (!this.CANVAS) {
			this.CANVAS = new OffscreenCanvas(bitmap.width, bitmap.height)
		} else {
			this.CANVAS.height = bitmap.height
			this.CANVAS.width = bitmap.width
		}
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)
		ctx.drawImage(bitmap, 0, 0)

		//* Adjust brightness for each pixel
		let data = ctx.getImageData(0, 0, this.CANVAS.width, this.CANVAS.height)
		this._normalizeColorBrightness(data)

		//!!! DEBUG
		blurAmount = 32
		if (blurAmount > 0) {
			this._fastGaussianBlur(data.data, this.blurAmount, this.CANVAS)
			ctx.putImageData(data, 0, 0)
		}
		this.blurAmount = blurAmount

		return this.CANVAS.transferToImageBitmap()
	},

	fullExpandPixelRow(bitmap, TBwidth, TBheight, contentWidth, xContentOffset) {
		console.log('[worker] algorithms:', algorithms)
		const canvas = new OffscreenCanvas(TBwidth, TBheight)
		const ctx = canvas.getContext('2d', CONTEXT_SETTINGS)
		ctx.drawImage(bitmap, xContentOffset, 0)

		//TODO: START_HEIGHT & PIXEL_ROWS_TO_USE should be a pref or function params
		const START_HEIGHT = 0
		const PIXEL_ROWS_TO_USE = 4
		let firstRow = ctx.getImageData(0, START_HEIGHT, TBwidth, TBheight)
		let data = firstRow.data

		// Make a seamless verticall pattern with the first 4 pixel rows
		// Remember Uint8ClampedArray takes a RGBA array [r,g,b,a] for a single bit,
		// so we have to create an array contanining the tab bar dimensions * 4
		const iLength = data.length
		const firstRowDatalength = TBwidth * PIXEL_ROWS_TO_USE * 4

		// Skip the first 4 pixel rows as they already painted with the pattern
		for (let i = firstRowDatalength; i < iLength; i += 4) {
			// As i increases beyond the initial pixel rows, the index j resets to 0
			// and starts over, copying the pixel data from the start of the first rows again.
			const j = i % firstRowDatalength

			data[i] = data[j] // red
			data[i + 1] = data[j + 1] // green
			data[i + 2] = data[j + 2] // blue
			// ignore alpha
		}

		//* Adjust brightness for each pixel
		this._normalizeColorBrightness(data)

		// Finally expand the pixels horizontally if pref enabled using the first/last painted pixels of each row
		if (this.shouldFillGaps) {
			this.fillGaps(data, TBwidth, TBheight, xContentOffset, contentWidth)
		}

		// Draw
		this._fastGaussianBlur(data, this.blurAmount, canvas)
		ctx.putImageData(firstRow, 0, 0)

		return canvas.transferToImageBitmap()
	},

	fillGaps(data, TBwidth, TBheight, xContentOffset, contentWidth) {
		const leftGap = xContentOffset
		const rightGap = contentWidth + leftGap

		let shouldFillLeftGap = leftGap > 0
		let shouldFillRightGap = rightGap < TBwidth

		if (shouldFillLeftGap || shouldFillRightGap) {
			console.log(
				'[WORKER] Filling gaps in canvas? ',
				shouldFillLeftGap || shouldFillRightGap,
				{ leftGap, rightGap, TBwidth, contentWidth }
			)

			// Left expand
			if (shouldFillLeftGap) {
				let rowStart = Math.round(leftGap * 4)
				if (rowStart % 2) rowStart += 1 // fix odd numbers rounding

				console.log(
					'[worker] Expanding left side\npixels:',
					rowStart,
					TBwidth * 4,
					rowStart + TBwidth * 4,
					data[rowStart],
					data[rowStart + 1],
					data[rowStart + 2]
				)

				for (let row = 0; row < TBheight; row++) {
					let startIndex = row * TBwidth * 4 // Starting index for the current row
					let rowStartIndex = startIndex + rowStart // Index of the rowStart pixel

					// Extract the color values from the rowStart pixel
					let r = data[rowStartIndex]
					let g = data[rowStartIndex + 1]
					let b = data[rowStartIndex + 2]

					for (let i = 0; i < rowStart; i += 4) {
						// Copy from the first painted pixel
						data[startIndex + i] = r
						data[startIndex + i + 1] = g
						data[startIndex + i + 2] = b
					}
				}

				// Right expand
				if (shouldFillRightGap) {
					console.log('[worker] expanding right side')

					const rowEnd = rightGap * 4
					for (let row = 0; row < TBheight; row++) {
						let startIndex = row * TBwidth * 4 // Starting index for the current row
						let rowEndIndex = startIndex + rowEnd // Index of the rowEnd pixel

						// Extract the color values from the rowEnd pixel
						let r = data[rowEndIndex]
						let g = data[rowEndIndex + 1]
						let b = data[rowEndIndex + 2]

						// Copy the color to the right side pixels
						for (let i = rowEndIndex; i < startIndex + TBwidth * 4; i += 4) {
							data[i] = r
							data[i + 1] = g
							data[i + 2] = b
							data[i + 3] = 255 // Set alpha to fully opaque
						}
					}
				}
			}
		}
	},

	_normalizeColorBrightness(data) {
		// TODO: run _normalizeColorBrightness() after repeating the pixels vertically and before expanding the pixels horizontally.-
		// TODO: only run _normalizeColorBrightness for the pixels that will be repeated
		function isTextColorDark(r, g, b) {
			return 0.2125 * r + 0.7154 * g + 0.0721 * b <= 110
		}

		function darkenColor(r, g, b, factor) {
			return [
				Math.max(0, r * factor), // r
				Math.max(0, g * factor), // g
				Math.max(0, b * factor), // b
			]
		}

		let needsDarkening = false

		// Sample a few pixels to determine if darkening is needed (every 10 pixels)
		const sampleRate = 10
		for (let i = 0; i < data.length; i += 4 * sampleRate) {
			if (!isTextColorDark(data[i], data[i + 1], data[i + 2])) {
				needsDarkening = true
				break
			}
		}
		if (!needsDarkening) return

		// Darkening factor
		const darkenFactor = 0.7

		for (let i = 0; i < data.length; i += 4) {
			let r = data[i]
			let g = data[i + 1]
			let b = data[i + 2]

			// Apply darkening only if the pixel is not already dark
			let factor = darkenColor(r, g, b, darkenFactor)
			data[i] = factor[0]
			data[i + 1] = factor[1]
			data[i + 2] = factor[2]
		}
	},

	_fastGaussianBlur(data, radius, canvas) {
		if (!algorithms.stackWasm) return

		console.log('[worker] fastGaussianBlur!', radius)

		let width = canvas.width
		let height = canvas.height

		// TODO: reuse data instead of cloning it
		let red = new Uint8ClampedArray(width * height)
		let green = new Uint8ClampedArray(width * height)
		let blue = new Uint8ClampedArray(width * height)

		for (let i = 0; i < width * height; i++) {
			red[i] = data[i * 4] // Red
			green[i] = data[i * 4 + 1] // Green
			blue[i] = data[i * 4 + 2] // Blue
		}

		try {
			// TODO: modify WASM to apply stack blur on multiple channels instead of this mess
			let r = algorithms.stackWasm(red, width, height, radius)
			let g = algorithms.stackWasm(green, width, height, radius)
			let b = algorithms.stackWasm(blue, width, height, radius)

			for (let i = 0; i < width * height; i++) {
				data[i * 4] = r[i] // R
				data[i * 4 + 1] = g[i] // G
				data[i * 4 + 2] = b[i] // B
				// Alpha channel remains unchanged
			}
		} catch (err) {
			console.error('[worker] fastGaussianBlur failed!', err)
		}
	},

	close() {
		self.close()
		this.CANVAS = null
	},
}

self.Agent = Agent
globalThis.Agent = Agent
