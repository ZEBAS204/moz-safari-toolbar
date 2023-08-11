This browser extension was forked from [jakwings's firefox-screenshot fork](https://github.com/jakwings/firefox-screenshot) of [M-Reimer/savescreenshot](https://github.com/M-Reimer/savescreenshot/tree/14315d4bdcec34efb85b9534701094e63af2b3c3) that was modified to make it work on Firefox version *57* and onward.

https://github.com/ZEBAS204/moz-safari-toolbar/assets/36385457/acebf77a-d16b-4492-a3ec-5729924f2f30

> **Warning**
> This is just a proof of concept.

## Problems

This extension works by capturing a tiny portion of the top page and converting it to an image, blur it and set as a theme background.

- [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) does not work in Firefox (August 2023). This extension uses canvas powered by CPU.

- Capturing the page can be done *only* (or as far as I know) in *two ways*:

  1. (extension only - currently in use) Using the [`browser.tabs.captureTab`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureTab)/[`browser.tabs.captureVisibleTab`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab) (or `DrawWindow` message in older versions) to take a screenshot of the current tab and process it on a `<canvas>` element.

  2. Using the [`WebCodecs API`](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) to draw a video stream of the current tab on a `<video>` element and later extract it into a `<canvas>` element to process it.
One drawback to the Canvas approach is that there is no guarantee that all video frames get processed.

### Limitations

This extension uses the [Theme API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/theme) to change the background of the toolbar and the status bar. Thus, is limited by how [Firefox allows and processes theme changes](https://github.com/mozilla/gecko-dev/blob/master/toolkit/modules/LightweightThemeConsumer.sys.mjs):

- Does not work properly with multiple Firefox instances. The background will change in all Firefox windows, including incognito (as Firefox does not support [`split` permission](https://bugzilla.mozilla.org/show_bug.cgi?id=1380812))

- Blobs backgrounds (`blob://...`) do not. Firefox only allows local image URLs defined in the extension manifest.

- Excessive use of cache: to prevent flickering ([example here](https://i.imgur.com/fqwnQro.gif)) of the background when changing, we use `additional_backgrounds` to stack the next image and "cache it" so when displayed is already loaded.

#### Discarded ideas

1. Capture the full page and displace the background based on the y-scroll axis:
   > The theme API does not support any *custom* values for alignment and is only limited to `top`, `bottom`, etc.

2. Migrate it into a *"chrome profile plugin"* (like [CustomJSforFx](https://github.com/Aris-t2/CustomJSforFx)):
   > The main focus of this extension is allowing *non-power-users* to enjoy the visuals with a simple click.

### Known issues

- Bottom search bar inherits the background.

- User theme's original background image will be replaced.

- Blob backgrounds (`blob://...`) do not work. Firefox only allows local images or `base64` encoded images as `background-image`.

- Scrolling too slowly will cause sticky/fixed elements to display.

- CPU intensive extension:
  > This extension is currently processing images on CPU-accelerated canvas (`2d context`). Aside from that, is also encoding and decoding a `base64` screenshot, resizing and blurring it, and worse, encoding it again to `base64` only to be decoded again by the browser.

- Background is not aligned properly:
  > To remove the *artifacts* of the blurred background at the edges ([example here](https://i.imgur.com/fqwnQro.gif)), the image needs to be upscaled to hide these hard edges.
  > Also, when taking a screenshot of the page, the width of the page scrollbars is subtracted from the final image.

- Background does not sync properly with the page scroll:
  > The other issues need to be solved before this one can be fixed.
  > But the idea to is:
  > - On **first load** of the page, the extension will have two options based on the user preferences on how to stylize the top of the page:
  >   1. Capture a tiny height of the top of the page and repeat in all the background.
  >   2. Set a solid color, based on the `theme-color` metadata of the page (similar to [Adaptive Tab Bar Colour](https://github.com/easonwong-de/Adaptive-Tab-Bar-Colour))
  > - **Static mode:** Create a static buffer of the page (up to `25%` as is the maximum distance the user can travel on a quick scroll) and keep repeating this behavior. Cut the full static buffer into small chunks so we can match them when the user scrolls.
  > - **Dynamic mode:** Listen to page mutations to verify if the page contains dynamic content. Re-create the buffer on demand.
  > - Cache the buffers (up to `25%`) for quick access in case the user scroll ups.
  > - The rest of the cache will be compressed down and decoded when needed.
  > - On page unload, compress down all buffers using a worker.
  > - On page load, use the behavior of *step 1* while decompressing the cache.
  > - On page close, clear the cache.
  >
  > **Note:** compressed cache will probably use [BlurHash Algorithm](https://github.com/woltapp/blurhash/blob/master/Algorithm.md) or [One-byte Granularity](https://stackoverflow.com/a/38126771) and the most expensive calculations should be migrated to WebAssembly and accessed through a shared worker.

---

## Notes:

- Maximum width/height of a PNG screenshot: 2147483647 pixels per specification

- Maximum width/height of a JPEG screenshot: 65535 pixels per specification

A screen of higher resolution (physical/virtual points per pixel of which is 1.5, 2, 2.5, 3, etc.) costs more computer memory (points converted to pixels) i.e. costs more pixels to save a screenshot unless you want to sacrifice the image quality by resizing and resampling.  For example, with 2x resolution, a 50x50 region will be saved as a screenshot of size 100x100, resulting in an image not only 4 times larger in display size but also likely in file size.
