import L from "leaflet";
import districts from "../data/forecastDistricts.json";
import { estimateTemperature, MAX_INTERPOLATION_KM, temperatureColor, type ForecastTemperature } from "../domain/forecastHeat";

/** A view-sized raster below markers. Real district geometry is a land mask, never a uniform heat fill. */
export function temperatureLayer(points: ForecastTemperature[]): L.Layer {
  const Surface = L.Layer.extend({
    onAdd(map: L.Map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "forecast-temperature-surface");
      this._canvas.setAttribute("aria-hidden", "true");
      map.getPane("heat-coverage")!.append(this._canvas);
      map.on("moveend zoomend resize", this.redraw, this);
      this.redraw();
    },
    onRemove(map: L.Map) {
      map.off("moveend zoomend resize", this.redraw, this);
      this._canvas.remove();
    },
    redraw() {
      const map = this._map as L.Map, canvas = this._canvas as HTMLCanvasElement, size = map.getSize();
      if (!size.x || !size.y) return;
      const step = 5, low = document.createElement("canvas");
      low.width = Math.ceil(size.x / step); low.height = Math.ceil(size.y / step);
      const lowContext = low.getContext("2d")!, pixels = lowContext.createImageData(low.width, low.height);
      // Only consider points near the viewport, so a full WA live forecast stays responsive at street zoom.
      const bounds = map.getBounds().pad(1);
      const nearby = points.filter((point) => bounds.contains([point.lat, point.lng]) || map.distance(map.getCenter(), [point.lat, point.lng]) < MAX_INTERPOLATION_KM * 1000);
      for (let y = 0; y < low.height; y++) for (let x = 0; x < low.width; x++) {
        const at = map.containerPointToLatLng([(x + 0.5) * step, (y + 0.5) * step]);
        const estimate = estimateTemperature(nearby, at.lat, at.lng);
        if (!estimate) continue;
        const color = temperatureColor(estimate.max);
        const fade = Math.min(1, Math.max(0, (MAX_INTERPOLATION_KM - estimate.distanceKm) / 30));
        color[3] = Math.round(color[3] * fade);
        pixels.data.set(color, (y * low.width + x) * 4);
      }
      lowContext.putImageData(pixels, 0, 0);
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(size.x * ratio); canvas.height = Math.round(size.y * ratio);
      canvas.style.width = `${size.x}px`; canvas.style.height = `${size.y}px`;
      L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
      const context = canvas.getContext("2d")!;
      context.scale(ratio, ratio);
      context.beginPath();
      for (const feature of districts.features) {
        const polygons = feature.geometry.type === "MultiPolygon" ? feature.geometry.coordinates : [feature.geometry.coordinates];
        for (const polygon of polygons) for (const ring of polygon) {
          for (let index = 0; index < ring.length; index++) {
            const coordinate = ring[index] as number[], pixel = map.latLngToContainerPoint([coordinate[1]!, coordinate[0]!]);
            if (index === 0) context.moveTo(pixel.x, pixel.y); else context.lineTo(pixel.x, pixel.y);
          }
          context.closePath();
        }
      }
      context.clip("evenodd");
      context.imageSmoothingEnabled = true;
      context.drawImage(low, 0, 0, size.x, size.y);
    },
  });
  return new Surface();
}
