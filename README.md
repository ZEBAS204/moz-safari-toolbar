This browser extension was forked from [jakwings's firefox-screenshot fork](https://github.com/jakwings/firefox-screenshot) of [M-Reimer/savescreenshot](https://github.com/M-Reimer/savescreenshot/tree/14315d4bdcec34efb85b9534701094e63af2b3c3) that was modified to make it work on Firefox version *57* and onward.

https://github.com/ZEBAS204/moz-safari-toolbar/assets/36385457/acebf77a-d16b-4492-a3ec-5729924f2f30

> **NOTE:**
> This is just a proof of concept.

Original Features:

- screenshots in PNG or JPEG format
- copy to pasteboard or save to a folder/directory
- regions of screenshot: full page, viewport or selection
- customizable filenames for screenshots
- customizable filename for save folder/directory

New Features (added by jakwings):

- maximum width or height of a PNG screenshot: 2147483647 pixels per specification
- maximum width or height of a JPEG screenshot: 65535 pixels per specification
- support for pages with right-to-left scrolling
- semi support for Firefox version 56

Note:

A screen of higher resolution (physical/virtual points per pixel of which is 1.5, 2, 2.5, 3, etc.) costs more computer memory (points converted to pixels) i.e. costs more pixels to save a screenshot, unless you want to sacrifice the image quality by resizing and resampling.  For example, with 2x resolution, a 50x50 region will be saved as a screenshot of size 100x100, resulting in an image not only 4 times larger in display size but also likely in file size.
