function getDimensions(window) {
	const {
		innerHeight,
		innerWidth,
		scrollMaxY,
		scrollMaxX,
		scrollMinY,
		scrollMinX,
		scrollY,
		scrollX,
	} = window

	let scrollWidth = innerWidth + scrollMaxX - scrollMinX
	let scrollHeight = innerHeight + scrollMaxY - scrollMinY
	//! let clientHeight = innerHeight
	//! let clientWidth = innerWidth

	const scrollbarHeight = {}
	const scrollbarWidth = {}
	window.windowUtils.getScrollbarSize(false, scrollbarWidth, scrollbarHeight)

	scrollWidth -= scrollbarWidth.value
	scrollHeight -= scrollbarHeight.value
	//! clientWidth -= scrollbarWidth.value
	//! clientHeight -= scrollbarHeight.value

	/*
	 * clientWidth: The width of the viewport
	 * clientHeight: The height of the viewport
	 * scrollWidth: The width of the enitre page
	 * scrollHeight: The height of the entire page
	 * scrollX: The X scroll offset of the viewport
	 * scrollY: The Y scroll offest of the viewport
	 * scrollMinX: The X minimum the viewport can scroll to
	 * scrollMinY: The Y minimum the viewport can scroll to
	 * scrollMaxX: The X maximum the viewport can scroll to
	 * scrollMaxY: The Y maximum the viewport can scroll to
	 */
	return {
		scrollY,
		scrollX,

		left: 0,
		right: scrollWidth,

		top: 0,
		bottom: scrollHeight,

		width: scrollWidth,
		height: scrollHeight,
	}
}

addEventListener(
	'scroll',
	function (event) {
		console.debug('addEventListener:', event, this)
		const window = content

		const { scrollY } = window

		const data = {
			screen: getDimensions(window),
			/*{
				scrollY,
				scrollX,
				width: offsetWidth,
				height: offsetHeight,
				top: offsetTop,
				left: offsetLeft,
				// right: scrollMinX + scrollWidth,
				// bottom: scrollMinY + scrollHeight,
			},*/
			lastKnownScrollPosition: scrollY,
		}

		sendAsyncMessage('DynamicTabBar:Scroll', data)
	},
	{
		useCapture: false,
		passive: true,
	}
)

// Wait until the DOM is safe to manipulate
addEventListener(
	'load',
	(event) => {
		// FIXME: not working in privileged content aka Sandboxed mode as window is undefined
		const window = event.target.ownerGlobal
		const { document } = window
		if (document.readyState === 'loading') return

		console.debug(
			`${event.type}: ${document.readyState}`,
			event,
			this
		)

		// Some tabs like about: ones don't return the window object
		let data = null
		if (window) {
			// Took script from Adaptive-Tab-Bar-Colour extension: https://github.com/easonwong-de/Adaptive-Tab-Bar-Colour/blob/main/content_script.js#L266
			let colourScheme = window.matchMedia('(prefers-color-scheme: dark)')
				.matches
				? 'dark'
				: 'light'
			console.info('Color Scheme for tab?', colourScheme)
			let headerTag = document.querySelector(
				`meta[name="theme-color"][media="(prefers-color-scheme: ${colourScheme})"]`
			)
			console.info('meta themecolor element for tab', headerTag)
			if (headerTag == null)
				headerTag = document.querySelector(`meta[name="theme-color"]`)

			data = {
				screen: getDimensions(window),
				themeColor: headerTag?.content || null,
			}
		}

		sendAsyncMessage('DynamicTabBar:TabReady', data)
	},
	{
		capture: true,
		useCapture: true,
		passive: true,
	}
)

// TODO: since this is listener is exec once in a blue moon, should we just load it on demand when needed?
addMessageListener('DynamicTabBar:FetchDimensions', function () {
	const data = {
		screen: getDimensions(content),
	}
	sendAsyncMessage('DynamicTabBar:Dimensions', data)
})
