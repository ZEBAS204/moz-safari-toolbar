/*
    Firefox addon "Save Screenshot"
    Copyright (C) 2020  Manuel Reimer <manuel.reimer@gmx.de>
    Copyright (C) 2022  Jak.W <https://github.com/jakwings/firefox-screenshot>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

'use strict';

function abort(err) {
  if (err instanceof Error) {
    throw err;
  } else if (err instanceof ErrorEvent) {
    throw err.error || new Error(err.message);
  } else {
    throw new Error(err);
  }
}

function ignore() {
}

function T$(id, ...args) {
  return browser.i18n.getMessage(id, args);
}

function notify(message = '', {title = T$('extensionName'), id = ''} = {}) {
  browser.notifications.create(String(id), {
    type: 'basic',
    title: title,
    message: message,
  });
}

function alarm(message = '', {title = T$('extensionName'), id = ''} = {}) {
  browser.notifications.create(String(id), {
    type: 'basic',
    title: title,
    message: message,
  });
}

// Function which handles sending the "take screenshot" message to the active
// tab. Includes error handling with error notification.
async function SendMessage(aJsonMessage) {
  const tabs = await browser.tabs.query({active: true, currentWindow: true});
  const message = JSON.parse(aJsonMessage);
  message.type = "TakeScreenshot";
  try {
    await browser.tabs.sendMessage(tabs[0].id, message);
  }
  catch(err) {
    console.error("SaveScreenshot message sending error: " + err);
    alarm(T$("errorTextFailedSending"), {title: T$("errorTitleFailedSending")});
  }
}

// Function to generate list with menu entries based on the user settings.
async function GetMenuList() {
  const prefs = await Storage.get();
  if (prefs.formats.length == 1 && prefs.regions.length == 1)
    return [];

  const formats = [
    {id: "png",  label: "PNG"},
    {id: "jpg",  label: "JPEG"},
    {id: "copy", label: T$("format_copy_label")}
  ];
  const regions = [
    {id: "full",      label: T$("region_full_label")},
    {id: "viewport",  label: T$("region_viewport_label")},
    {id: "selection", label: T$("region_selection_label")}
  ];

  let template = "$REGION ($FORMAT)";
  if (prefs.formats.length == 1)
    template = "$REGION";
  else if (prefs.regions.length == 1)
    template = "$FORMAT";

  let list = [];
  for (let region of regions) {
    if (!prefs.regions.includes(region.id))
      continue;
    for (let format of formats) {
      if (!prefs.formats.includes(format.id))
        continue;
      list.push({
        label: template.replace("$REGION", region.label).replace("$FORMAT", format.label),
        data: JSON.stringify({format: format.id, region: region.id}),
      });
    }
  }

  return list;
}

class JobQueue {
  constructor() {
    this.queue = [];
  }
  push(func) {
    this.queue.push(func);
  }
  parallel() {
    return Promise.all(this.queue.splice(0).map(func => func()));
  }
  async serial() {
    let result = undefined;
    for (let func of this.queue.splice(0)) {
      result = await func(result);
    }
    return result;
  }
}

// only works for timers and promises in the same page
class Mutex {
  static registry = Object.create(null);

  // timeout in milliseconds
  constructor({lock_time = 0, retry_interval = 0} = {}) {
    this.id = Object.create(null);
    this.lock_time = (lock_time | 0) || (1000 * 60);
    this.retry_interval = (retry_interval | 0) || 1000;
  }

  lock(key, {retry = true, lock_time = 0, retry_interval = 0} = {}) {
    let opts = {
      retry: Boolean(retry),
      lock_time: (lock_time >= 1 ? (lock_time | 0) : this.lock_time),
      retry_interval: (retry_interval >= 1 ? (retry_interval | 0) : this.retry_interval),
    };
    let info = Mutex.registry[key], now = Date.now();
    if (info === undefined || info.id === this.id || info.deadline < now) {
      Mutex.registry[key] = {id: this.id, deadline: now + opts.lock_time};
      return Promise.resolve(true);
    }
    return (retry === true || --retry >= 0) ? new Promise(resolve => {
      setTimeout(async () => {
        resolve(await this.lock(key, opts));
      }, opts.retry_interval);
    }) : Promise.resolve(false);
  }

  unlock(key) {
    let info = Mutex.registry[key];
    if (info === undefined || info.id === this.id || info.deadline < Date.now()) {
      delete Mutex.registry[key];
      return true;
    } else {
      return false;
    }
  }
}
