export function getSeaDistanceScore(sourceRegion, targetId) {
  for (const band of sourceRegion?.sea_distances ?? []) {
    if ((band.provinces ?? []).includes(targetId)) {
      return Math.max(0, band.r || 0);
    }
  }
  return null;
}

export function getSeaTravelRange(unit) {
  return Math.max(0, unit?.sea_range || unit?.sea_hop_distance_km || 0);
}

export function getTravelDistance(
  sourceId,
  targetId,
  regions,
  neighborMap,
  movementType,
  seaRange,
  maxDepth,
  canVisit,
) {
  if (movementType === "sea") {
    const sourceRegion = regions[sourceId];
    if (!sourceRegion?.is_coastal) return null;
    const score = getSeaDistanceScore(sourceRegion, targetId);
    if (score === null || score > seaRange || !canVisit(targetId)) return null;
    return Math.max(1, Math.ceil(score / 20));
  }

  const visited = new Set([sourceId]);
  const queue = [{ regionId: sourceId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.regionId === targetId) return current.depth;
    if (current.depth >= maxDepth) continue;

    for (const neighborId of neighborMap[current.regionId] || []) {
      const region = regions[neighborId];
      if (!region || visited.has(neighborId) || !canVisit(neighborId)) continue;
      visited.add(neighborId);
      queue.push({ regionId: neighborId, depth: current.depth + 1 });
    }
  }

  return null;
}
