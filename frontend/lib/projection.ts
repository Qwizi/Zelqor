/**
 * Mercator projection utilities for converting geographic coordinates
 * (longitude/latitude) to pixel space within a given canvas.
 *
 * Uses the Web Mercator (EPSG:3857) formula — the same projection used
 * by web mapping libraries such as MapLibre GL and Google Maps.
 */

export interface Bounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

/**
 * Project a latitude value to a Mercator Y coordinate in the range [0, 1].
 * Latitude must be within the Web Mercator valid range (~-85.05 to ~85.05).
 */
function latToMercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

/**
 * Convert a geographic coordinate (longitude, latitude) to a pixel position
 * on a canvas, given a bounding box and the canvas dimensions.
 *
 * The bounding box defines the visible geographic region. Points outside
 * the bounding box will be projected but may fall outside [0, canvasSize].
 *
 * @param lng - Longitude in decimal degrees (-180 to 180)
 * @param lat - Latitude in decimal degrees (-90 to 90)
 * @param bounds - Geographic bounding box of the visible region
 * @param canvasSize - Width and height of the target canvas in pixels
 * @returns [x, y] pixel coordinates
 */
export function lngLatToPixel(lng: number, lat: number, bounds: Bounds, canvasSize: CanvasSize): [number, number] {
  // Normalise longitude to [0, 1] within bounds
  const xNorm = (lng - bounds.minLng) / (bounds.maxLng - bounds.minLng);

  // Convert latitudes to Mercator Y values
  const yMin = latToMercatorY(bounds.minLat);
  const yMax = latToMercatorY(bounds.maxLat);
  const yVal = latToMercatorY(lat);

  // Normalise Mercator Y to [0, 1]; Y axis is flipped (north = 0)
  const yNorm = 1 - (yVal - yMin) / (yMax - yMin);

  const px = xNorm * canvasSize.width;
  const py = yNorm * canvasSize.height;

  return [px, py];
}
