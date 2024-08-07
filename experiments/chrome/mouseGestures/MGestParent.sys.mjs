addEventListener(
	'scroll',
	function (event) {
		console.log('addEventListener:', event, this)

		const { scrollY, scrollX, document } = event.target.ownerGlobal
		const { offsetHeight, offsetWidth, offsetLeft, offsetTop } = document.body

		console.log(
			'No flushing:',
			event.view.windowUtils.getBoundsWithoutFlushing(event.target.ownerGlobal)
		)

		const data = {
			screen: {
				scrollY,
				scrollX,
				width: offsetWidth,
				height: offsetHeight,
				top: offsetTop,
				left: offsetLeft,
				//right: scrollMinX + scrollWidth,
				//bottom: scrollMinY + scrollHeight,
			},
			tagName: event.target.tagName,
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
		const { document, body, getComputedStyle } = event.target.ownerGlobal
		if (document.readyState === 'loading') return
		console.log(`${event.type}:`, event, this)

		// Took script from Adaptive-Tab-Bar-Colour extension: https://github.com/easonwong-de/Adaptive-Tab-Bar-Colour/blob/main/content_script.js#L266
		const colourScheme = window.matchMedia('(prefers-color-scheme: dark)')
			.matches
			? 'dark'
			: 'light'
		let headerTag = document.querySelector(
			`meta[name="theme-color"][media="(prefers-color-scheme: ${colourScheme})"]`
		)
		if (headerTag === null)
			headerTag = document.querySelector(`meta[name="theme-color"]`)

		const data = {
			backgroundColor: getComputedStyle(body).backgroundColor || null,
			themeColor: headerTag ? headerTag.content : null,
		}

		sendAsyncMessage('DynamicTabBar:TabReady', data)
	},
	{
		capture: true,
		useCapture: true,
		passive: true,
	}
)

addMessageListener('alert', function (msg) {
	console.log('ALERT\naddMessageListener:', msg)
})
