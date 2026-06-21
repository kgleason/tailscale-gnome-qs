// Pure data-transformation helpers for the tailscaled local API responses.
//
// This module intentionally has NO gi:// imports, so it loads both inside
// gnome-shell (GJS) and in plain Node, where it is unit tested
// (see ../../tests/parsing.test.js).

// Build the PATCH body for /localapi/v0/prefs. tailscaled applies a field only
// when an accompanying "<key>set" boolean is also true, so mirror every key.
export function prefsUpdateBody(prefs) {
    return {
        ...prefs,
        ...Object.fromEntries(
            Object.keys(prefs).map(key => [`${key}set`, true]),
        ),
    };
}

// Normalize the peers from a /localapi/v0/status response into the node objects
// the UI renders, sorted: exit node first, then online, then nodes usable as an
// exit node, then alphabetically by name.
export function nodesFromStatus(prefs, peers) {
    return peers
        .map(peer => ({
            id: peer.ID,
            name: peer.DNSName.split(".")[0],
            os: peer.OS,
            exit_node: peer.ID == prefs.ExitNodeID,
            exit_node_option: peer.ExitNodeOption,
            online: peer.Online,
            ips: peer.TailscaleIPs,
            mullvad: peer.Tags?.includes("tag:mullvad-exit-node") || false,
            location: peer.Location,
        }))
        .sort((a, b) =>
            (b.exit_node - a.exit_node)
            || (b.online - a.online)
            || (b.exit_node_option - a.exit_node_option)
            || a.name.localeCompare(b.name)
        );
}

// Normalize the peers from a watch-ipn-bus NetMap update into the same shape as
// the /localapi/v0/status peers, so the rest of the code can treat them alike.
export function peersFromNetMap(netmapPeers) {
    return netmapPeers.map(peer => ({
        ID: peer.StableID,
        DNSName: peer.Name,
        OS: peer.Hostinfo.OS,
        ExitNodeOption: peer.AllowedIPs?.includes("0.0.0.0/0"),
        Online: peer.Online,
        TailscaleIPs: peer.Addresses.map(address => address.split("/")[0]),
        Tags: peer.Tags,
        Location: peer.Hostinfo.Location,
    }));
}
