import test from "node:test";
import assert from "node:assert/strict";

import {
  prefsUpdateBody,
  nodesFromStatus,
  peersFromNetMap,
} from "../tailscale@joaophi.github.com/parsing.js";

test("prefsUpdateBody adds a <key>set flag for each pref", () => {
  assert.deepEqual(prefsUpdateBody({ WantRunning: true, ShieldsUp: false }), {
    WantRunning: true,
    WantRunningset: true,
    ShieldsUp: false,
    ShieldsUpset: true,
  });
});

test("prefsUpdateBody on an empty object is empty", () => {
  assert.deepEqual(prefsUpdateBody({}), {});
});

test("nodesFromStatus derives short name, exit-node flag, and mullvad tag", () => {
  const prefs = { ExitNodeID: "B" };
  const peers = [
    {
      ID: "A", DNSName: "alpha.tail.ts.net", OS: "linux", Online: true,
      ExitNodeOption: true, TailscaleIPs: ["100.0.0.1"], Tags: [],
    },
    {
      ID: "B", DNSName: "beta.tail.ts.net", OS: "linux", Online: true,
      ExitNodeOption: true, TailscaleIPs: ["100.0.0.2"],
      Tags: ["tag:mullvad-exit-node"],
    },
  ];

  const nodes = nodesFromStatus(prefs, peers);
  const beta = nodes.find(n => n.id === "B");
  const alpha = nodes.find(n => n.id === "A");

  assert.equal(beta.name, "beta");
  assert.equal(beta.exit_node, true);
  assert.equal(beta.mullvad, true);
  assert.equal(alpha.exit_node, false);
  assert.equal(alpha.mullvad, false); // empty Tags -> false, never undefined
});

test("nodesFromStatus handles peers with no Tags (undefined)", () => {
  const [node] = nodesFromStatus(
    { ExitNodeID: "" },
    [{ ID: "A", DNSName: "a.x", Online: true, ExitNodeOption: false, TailscaleIPs: [] }],
  );
  assert.equal(node.mullvad, false);
});

test("nodesFromStatus sorts exit node first, then online, then by name", () => {
  const prefs = { ExitNodeID: "exit" };
  const peers = [
    { ID: "z", DNSName: "zeta.x", Online: false, ExitNodeOption: false, TailscaleIPs: [], Tags: [] },
    { ID: "a", DNSName: "alpha.x", Online: true, ExitNodeOption: false, TailscaleIPs: [], Tags: [] },
    { ID: "m", DNSName: "mike.x", Online: true, ExitNodeOption: false, TailscaleIPs: [], Tags: [] },
    { ID: "exit", DNSName: "exit.x", Online: true, ExitNodeOption: true, TailscaleIPs: [], Tags: [] },
  ];

  const order = nodesFromStatus(prefs, peers).map(n => n.name);
  assert.deepEqual(order, ["exit", "alpha", "mike", "zeta"]);
});

test("peersFromNetMap normalizes NetMap peers and strips IP CIDR suffixes", () => {
  const [p] = peersFromNetMap([
    {
      StableID: "X",
      Name: "x.tail.ts.net",
      Hostinfo: { OS: "linux", Location: { Country: "US" } },
      AllowedIPs: ["100.0.0.5/32", "0.0.0.0/0"],
      Online: true,
      Addresses: ["100.0.0.5/32", "fd7a::1/128"],
      Tags: ["tag:server"],
    },
  ]);

  assert.equal(p.ID, "X");
  assert.equal(p.DNSName, "x.tail.ts.net");
  assert.equal(p.OS, "linux");
  assert.equal(p.ExitNodeOption, true); // advertises 0.0.0.0/0
  assert.deepEqual(p.TailscaleIPs, ["100.0.0.5", "fd7a::1"]);
  assert.deepEqual(p.Location, { Country: "US" });
});

test("peersFromNetMap: without 0.0.0.0/0, ExitNodeOption is false", () => {
  const [p] = peersFromNetMap([
    {
      StableID: "Y", Name: "y.x", Hostinfo: { OS: "linux" },
      AllowedIPs: ["100.0.0.6/32"], Online: false,
      Addresses: ["100.0.0.6/32"], Tags: [],
    },
  ]);
  assert.equal(p.ExitNodeOption, false);
});
