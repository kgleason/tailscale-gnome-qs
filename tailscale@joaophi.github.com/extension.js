/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

/* exported init */
import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import St from "gi://St";

import { Extension, gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as MessageTray from "resource:///org/gnome/shell/ui/messageTray.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import * as QuickSettings from "resource:///org/gnome/shell/ui/quickSettings.js";

// This is the live instance of the Quick Settings menu
const QuickSettingsMenu = Main.panel.statusArea.quickSettings;

import { Tailscale } from "./tailscale.js";
import { clearSources } from "./timeout.js";

// A single reusable notification source for the transient "IP copied" banners.
let notifySource = null;

function notifyCopied(gicon, name, ip) {
  if (!notifySource) {
    notifySource = new MessageTray.Source({ title: "Tailscale", icon: gicon });
    notifySource.connect("destroy", () => { notifySource = null; });
    Main.messageTray.add(notifySource);
  }
  const notification = new MessageTray.Notification({
    source: notifySource,
    title: _("IP address copied"),
    body: `${name} (${ip})`,
    gicon,
    isTransient: true,
  });
  notifySource.addNotification(notification);
}

const TailscaleIndicator = GObject.registerClass(
  class TailscaleIndicator extends QuickSettings.SystemIndicator {
    _init(icon, tailscale) {
      super._init();

      // Create the icon for the indicator
      const up = this._addIndicator();
      up.gicon = icon;
      tailscale.bind_property("running", up, "visible", GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.DEFAULT);

      // Create the icon for the indicator
      const exit = this._addIndicator();
      exit.icon_name = "network-vpn-symbolic";
      const setVisible = () => { exit.visible = tailscale.running && tailscale.exit_node != ""; }
      tailscale.connect("notify::exit-node", () => setVisible());
      tailscale.connect("notify::running", () => setVisible());
      setVisible();
    }
  }
);

const TailscaleDeviceItem = GObject.registerClass(
  class TailscaleDeviceItem extends PopupMenu.PopupBaseMenuItem {
    _init(icon_name, text, subtitle, onClick, onSecondaryClick) {
      super._init({
        activate: !!onClick,
      });

      const icon = new St.Icon({
        style_class: 'popup-menu-icon',
      });
      this.add_child(icon);
      icon.icon_name = icon_name;

      const label = new St.Label({
        x_expand: true,
      });
      this.add_child(label);
      label.text = text;

      const sub = new St.Label({
        style_class: 'device-subtitle',
      });
      this.add_child(sub);
      sub.text = subtitle;

      if (onClick)
        this.connect('activate', () => onClick());

      // Right-click (secondary button) copies the node's IP. Handled via the
      // button-press-event signal so it coexists with the item's normal
      // left-click activation. Replaces the old Clutter.ClickAction long-press,
      // which was removed in GNOME 49 and never worked once ported to gestures.
      this.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
          onSecondaryClick();
          return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
      });
    }
  }
);

const TailscaleProfileItem = GObject.registerClass(
  class TailscaleProfileItem extends PopupMenu.PopupBaseMenuItem {
    _init(title, subtitle, enabled, onClick) {
      super._init({
        activate: onClick,
      });

      const label = new St.Label({
        x_expand: true,
      });
      this.add_child(label);
      label.text = title;

      const sub = new St.Label({
        style_class: 'device-subtitle',
      });
      this.add_child(sub);
      sub.text = subtitle;

      if (enabled) {
        const icon = new St.Icon({ style_class: 'system-status-icon' });
        this.add_child(icon);
        icon.icon_name = 'object-select-symbolic'
      }

      this.connect('activate', () => onClick());
    }

    activate(event) {
      if (this._activatable)
        this.emit('activate', event);
    }
  }
);

const PopupScrollableSubMenuMenuItem = GObject.registerClass(
  class PopupScrollableSubMenuMenuItem extends PopupMenu.PopupSubMenuMenuItem {
    _init(text) {
      super._init(text);

      // Cap the submenu's scroll view height and force a vertical scrollbar so
      // long node lists scroll instead of growing past the bottom of the
      // screen. Capping the scroll view (not box.height, the old approach) is
      // what actually produces overflow to scroll on GNOME 49/50.
      this.menu.actor.set_style('max-height: 300px;');
      this.menu.actor.vscrollbar_policy = St.PolicyType.AUTOMATIC;
      this.menu._needsScrollbar = () => true;
    }
  }
);

const TailscaleMenuToggle = GObject.registerClass(
  class TailscaleMenuToggle extends QuickSettings.QuickMenuToggle {
    _init(icon, tailscale) {
      super._init({
        gicon: icon,
        toggleMode: true,
        menuEnabled: true,
      });

      this.title = "Tailscale";
      tailscale.bind_property("running", this, "checked", GObject.BindingFlags.SYNC_CREATE | GObject.BindingFlags.BIDIRECTIONAL);

      // This function is unique to this class. It adds a nice header with an
      // icon, title and optional subtitle. It's recommended you do so for
      // consistency with other menus.
      tailscale.connect("notify::exit-node-name", () => {
        this.subtitle = tailscale.exit_node_name;
        this.menu.setHeader(icon, this.title, this.subtitle);
      });
      this.menu.setHeader(icon, this.title, tailscale.exit_node_name);

      // NODES
      // Collapsible submenu whose scroll view is height-capped so long node
      // lists scroll instead of overflowing the menu.
      const mnodes = new PopupScrollableSubMenuMenuItem(_("Nodes"));
      const nodes = new PopupMenu.PopupMenuSection();
      const update_nodes = (obj) => {
        nodes.removeAll();
        const mullvad = new PopupMenu.PopupSubMenuMenuItem("Mullvad", false, {});
        for (const node of obj.nodes) {
          const menu = (node.mullvad && !node.exit_node) ? mullvad.menu : nodes;
          const device_icon = !node.online
            ? "network-offline-symbolic"
            : ((node.os == "android" || node.os == "iOS")
              ? "phone-symbolic"
              : (node.mullvad
                ? "network-vpn-symbolic"
                : "computer-symbolic"));
          const subtitle = node.exit_node ? _("disable exit node") : (node.exit_node_option ? _("use as exit node") : "");
          const onClick = node.exit_node_option ? () => { tailscale.exit_node = node.exit_node ? "" : node.id; } : null;
          const onSecondaryClick = () => {
            if (!node.ips)
              return false;

            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, node.ips[0]);
            St.Clipboard.get_default().set_text(St.ClipboardType.PRIMARY, node.ips[0]);
            notifyCopied(icon, node.name, node.ips[0]);
            return true;
          };

          menu.addMenuItem(new TailscaleDeviceItem(device_icon, node.name, subtitle, onClick, onSecondaryClick));
        }
        if (mullvad.menu.isEmpty()) {
          mullvad.destroy();
        } else {
          nodes.addMenuItem(mullvad);
        }
      }
      tailscale.connect("notify::nodes", (obj) => update_nodes(obj));
      update_nodes(tailscale);
      mnodes.menu.addMenuItem(nodes);
      this.menu.addMenuItem(mnodes);

      // SEPARATOR
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // PREFS
      const prefs = new PopupMenu.PopupSubMenuMenuItem(_("Settings"), false, {});

      const routes = new PopupMenu.PopupSwitchMenuItem(_("Accept routes"), tailscale.accept_routes, {});
      tailscale.connect("notify::accept-routes", (obj) => routes.setToggleState(obj.accept_routes));
      routes.connect("toggled", (item) => tailscale.accept_routes = item.state);
      prefs.menu.addMenuItem(routes);

      const dns = new PopupMenu.PopupSwitchMenuItem(_("Accept DNS"), tailscale.accept_dns, {});
      tailscale.connect("notify::accept-dns", (obj) => dns.setToggleState(obj.accept_dns));
      dns.connect("toggled", (item) => tailscale.accept_dns = item.state);
      prefs.menu.addMenuItem(dns);

      const lan = new PopupMenu.PopupSwitchMenuItem(_("Allow LAN access"), tailscale.allow_lan_access, {});
      tailscale.connect("notify::allow-lan-access", (obj) => lan.setToggleState(obj.allow_lan_access));
      lan.connect("toggled", (item) => tailscale.allow_lan_access = item.state);
      prefs.menu.addMenuItem(lan);

      const shields = new PopupMenu.PopupSwitchMenuItem(_("Shields up"), tailscale.shields_up, {});
      tailscale.connect("notify::shields-up", (obj) => shields.setToggleState(obj.shields_up));
      shields.connect("toggled", (item) => tailscale.shields_up = item.state);
      prefs.menu.addMenuItem(shields);

      const ssh = new PopupMenu.PopupSwitchMenuItem(_("SSH"), tailscale.ssh, {});
      tailscale.connect("notify::ssh", (obj) => ssh.setToggleState(obj.ssh));
      ssh.connect("toggled", (item) => tailscale.ssh = item.state);
      prefs.menu.addMenuItem(ssh);

      this.menu.addMenuItem(prefs);

      // PROFILES
      const profiles = new PopupMenu.PopupSubMenuMenuItem(_("Profiles"), false, {});
      const update_profiles = (obj) => {
        profiles.menu.removeAll();
        for (const p of obj.profiles) {
          let enabled = obj._prefs.ControlURL === p.ControlURL && obj._prefs.Config.UserProfile.ID === p.UserProfile.ID;
          const onClick = () => { tailscale.profiles = p.ID; }
          profiles.menu.addMenuItem(new TailscaleProfileItem(p.Name, p.NetworkProfile.DomainName, enabled, onClick));
        }
      }
      tailscale.connect("notify::profiles", (obj) => update_profiles(obj));
      update_nodes(tailscale);
      this.menu.addMenuItem(profiles);
    }
  }
);

export default class TailscaleExtension extends Extension {
  enable() {
    const icon = Gio.icon_new_for_string(`${this.path}/icons/tailscale-symbolic.svg`);

    this._tailscale = new Tailscale();
    this._indicator = new TailscaleIndicator(icon, this._tailscale);
    this._menu = new TailscaleMenuToggle(icon, this._tailscale);
    this._indicator.quickSettingsItems.push(this._menu);
    QuickSettingsMenu.addExternalIndicator(this._indicator);
  }

  disable() {
    clearSources();

    this._menu.destroy();
    this._menu = null;

    this._indicator.destroy();
    this._indicator = null;

    this._tailscale.destroy();
    this._tailscale = null;

    if (notifySource) {
      notifySource.destroy();
      notifySource = null;
    }
  }
}
