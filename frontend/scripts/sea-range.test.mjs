import assert from "node:assert/strict";
import test from "node:test";

import { getSeaTravelRange, getTravelDistance } from "../lib/gameTravel.js";

test("sea travel range falls back to sea_hop_distance_km", () => {
  assert.equal(getSeaTravelRange({ sea_range: 0, sea_hop_distance_km: 2800 }), 2800);
  assert.equal(getSeaTravelRange({ sea_range: 80, sea_hop_distance_km: 2800 }), 80);
});

test("sea travel distance allows long-range coastal travel when fallback range is present", () => {
  const regions = {
    ny: {
      is_coastal: true,
      sea_distances: [{ r: 80, provinces: ["lisbon"] }],
    },
    lisbon: {
      is_coastal: true,
    },
  };

  const distance = getTravelDistance(
    "ny",
    "lisbon",
    regions,
    {},
    "sea",
    getSeaTravelRange({ sea_range: 0, sea_hop_distance_km: 2800 }),
    4,
    () => true,
  );

  assert.equal(distance, 4);
});

test("sea travel blocks non-coastal targets", () => {
  const regions = {
    a: {
      is_coastal: true,
      sea_distances: [{ r: 40, provinces: ["b"] }],
    },
    b: {
      is_coastal: false,
    },
  };

  const distance = getTravelDistance(
    "a",
    "b",
    regions,
    {},
    "sea",
    getSeaTravelRange({ sea_range: 80, sea_hop_distance_km: 2800 }),
    4,
    (targetId) => regions[targetId]?.is_coastal === true,
  );

  assert.equal(distance, null);
});
