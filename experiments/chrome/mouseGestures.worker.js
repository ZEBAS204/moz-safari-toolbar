/**
 * A worker dedicated for canvas manipulation of MGesture
 */
'use strict'

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

const CONTEXT_SETTINGS = {
	alpha: false,
	// If true, the canvas must be created, drawn to, and read from entirely on the CPU.
	// Depends on pref gfx.canvas.willreadfrequently.enabled
	willReadFrequently: false,
	imageSmoothingEnabled: false,
}

const Agent = {
	CANVAS: null,
	blurAmount: 3,
	shouldFillGaps: true, // If we should expand the canvas to fill the gaps of the scrollbars and side bar

	// Checks if the specified file exists and has an age less than as
	// specifed (in seconds).
	helloWorld() {
		console.log('[WORKER] Hello World')
	},

	init(canvasRef) {
		console.log('[WORKER] INIT OFFSCREEN CANVAS', canvasRef)
		globalThis.CANVAS = canvasRef
		this.CANVAS = globalThis.CANVAS //* TEMP: allow to be accessed through console
		this.ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)
	},

	paintCanvas(_id, bitmap, blurAmount) {
		console.log('[WORKER] Painting canvas', this.CANVAS, ...arguments)

		if (!this.CANVAS)
			this.CANVAS = new OffscreenCanvas(bitmap.width, bitmap.height)
		else {
			Object.assign(this.CANVAS, {
				height: bitmap.height,
				width: bitmap.width,
			})
		}
		const ctx = this.CANVAS.getContext('2d', CONTEXT_SETTINGS)
		ctx.drawImage(bitmap, 0, 0)
		// this.fastGaussianBlur(this.CANVAS, blurAmount)
		this.blurAmount = blurAmount

		return this.CANVAS.transferToImageBitmap()
	},

	fullExpandPixelRow(bitmap, TBwidth, TBheight, contentWidth, xContentOffset) {
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
		const skipPaintedRow = firstRowDatalength

		for (let i = skipPaintedRow, j = 0; i < iLength; i += 4, j += 4) {
			if (j == firstRowDatalength) j = 0

			data[i] = data[j] // red
			data[i + 1] = data[j + 1] // green
			data[i + 2] = data[j + 2] // blue
			// ignore alpha
		}

		// Finally expand the pixels horizontally if pref enabled using the first/last painted pixels of each row
		if (this.shouldFillGaps) {
			const leftGap = xContentOffset
			const rightGap = contentWidth + leftGap

			console.log('[WORKER] Filling gaps in canvas: ', {
				leftGap,
				rightGap,
				TBwidth,
				contentWidth,
			})

			// TODO: check before looping if we actually have gaps

			const rowStart = leftGap * 4
			for (let row = 0; row < TBheight; row++) {
				let startIndex = row * TBwidth * 4 // Starting index for the current row

				// Left expand
				if (leftGap > 0) {
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
				// FIXME: this is not working as the contentWidth includes the scrollbar width
				const rowEnd = rightGap * 4
				/*
				if (rightGap < TBwidth) {
					console.log('[worker] expanding right side')

					console.log('[worker] a')
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
						data[i + 3] = 255
					}
				}
				*/
			}
		}

		// Draw
		ctx.putImageData(firstRow, 0, 0)
		// this.fastGaussianBlur(canvas, this.blurAmount)

		return canvas.transferToImageBitmap()
	},

	close() {
		self.close()
		this.CANVAS = null
	},
}

self.Agent = Agent
globalThis.Agent = Agent
