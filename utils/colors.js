/*
 All spaces should convert to X color space in this case,
 the color space this project uses is HSV
*/

function rgba2hsv(r, g, b, a = 1) {
	const v = Math.max(r, g, b)
	const c = v - Math.min(r, g, b)
	const h =
		c && (v == r ? (g - b) / c : v == g ? 2 + (b - r) / c : 4 + (r - g) / c)
	return [60 * (h < 0 ? h + 6 : h), v && c / v, v, a]
}

function anyToRgba(color) {
	// Neat trick from https://stackoverflow.com/a/70715080
	const tempElement = document.createElement('div')
	tempElement.style.color = color
	const colors = tempElement.style.color.match(/[0-9.]+/g).map((n) => Number(n))
	tempElement.remove()
	return colors // R = [0] G = [1] B = [2] A=[3]
}
