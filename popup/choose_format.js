/*
    Firefox addon "Save Screenshot"
    Copyright (C) 2017  Manuel Reimer <manuel.reimer@gmx.de>
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

async function CreateButtons() {
  let menus = await GetMenuList();

  menus.forEach((entry) => {
    let div = document.createElement('div');
    div.setAttribute('class', 'button');
    div.setAttribute('data-settings', entry.data);
    div.textContent = entry.label;
    document.body.appendChild(div);
  });

  //let modes = ['native_scroll', 'js_scroll', 'css_scroll'];
  //let level = document.createElement('div');
  //level.id = 'level';
  //level.className = 'button';
  //level.textContent = 'native_scroll';
  //// TODO: event listener
  //document.body.appendChild(level);
}

// TODO: copy jpeg
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('button')) {
    let data = e.target.getAttribute('data-settings');
    await SendMessage(data);
    window.close();
  }
});

CreateButtons();
