Firefox Screenshot
====================

This browser extension was forked from https://github.com/M-Reimer/savescreenshot/tree/14315d4bdcec34efb85b9534701094e63af2b3c3 and modified to make it work on Firefox version *57* and onward.  However [ManifestV2 extension might not be permitted to be *signed* by Mozilla in the future](https://blog.mozilla.org/addons/2022/05/18/manifest-v3-in-firefox-recap-next-steps/), which could mean that legacy browsers (except for modified versions of Firefox) can't receive automatic updates of this extension.

Original Features:

- screenshots in PNG or JPEG format
- copy to pasteboard or save to a folder/directory
- regions of screenshot: full page, viewport or selection
- customizable filenames for screenshots
- customizable filename for save folder/directory

New Features:

- maximum width or height of a PNG screenshot: 2147483647 pixels per specification
- maximum width or height of a JPEG screenshot: 65535 pixels per specification
- support for pages with right-to-left scrolling
- semi support for Firefox version 56

Note:

A screen of higher resolution (physical/virtual points per pixel of which is 1.5, 2, 2.5, 3, etc.) costs more computer memory (points converted to pixels) i.e. costs more pixels to save a screenshot, unless you want to sacrifice the image quality by resizing and resampling.  For example, with 2x resolution, a 50x50 region will be saved as a screenshot of size 100x100, resulting in an image not only 4 times larger in display size but also likely in file size.

------------------------------------------------------------

Download:
- https://github.com/jakwings/firefox-screenshot/releases/download/latest/infinite_screenshots-latest.xpi

Hacking:
- https://github.com/jakwings/firefox-screenshot/archive/refs/heads/master.zip
- Do a [temporary install](https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Temporary_Installation_in_Firefox).
- https://extensionworkshop.com/documentation/enterprise/enterprise-distribution/

Localization: https://lusito.github.io/web-ext-translator/?gh=https://github.com/jakwings/firefox-screenshot

Other useful tools:
- https://github.com/jakwings/screenshot2html
- https://github.com/iipc/awesome-web-archiving
