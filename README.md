# tailscale-gnome-qs

[<img alt="" height="100" src="https://raw.githubusercontent.com/andyholmes/gnome-shell-extensions-badge/master/get-it-on-ego.svg?sanitize=true">](https://extensions.gnome.org/extension/6139/tailscale-qs/)

Add Tailscale to the GNOME quick settings: toggle the connection, browse your
nodes, pick an exit node, switch profiles, and flip common preferences without
leaving the panel.

Supports **GNOME Shell 45–50**, and both standard package and **snap**
installs of Tailscale (the tailscaled socket is detected automatically).

##### BUILD (UBUNTU)

```bash
sudo apt update && sudo apt install make gettext gnome-shell
make build
make install
```

Then log out and back in (GNOME caches extensions until the shell restarts) and
enable it:

```bash
gnome-extensions enable tailscale@joaophi.github.com
```

##### CONFIG
Make sure you set yourself tailscale operator

```bash
sudo tailscale set --operator=$USER
```

##### USAGE
- **Left-click a node** to use it as an exit node (or to disable the current one).
- **Right-click a node** to copy its IP address to the clipboard.

##### SCREENSHOT

![image](https://github.com/joaophi/tailscale-gnome-qs/assets/23062105/b4209a00-0cd8-45bd-869a-e2a0a7cfdb81)
