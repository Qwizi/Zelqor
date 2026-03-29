import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Zelqor",
    short_name: "Zelqor",
    description: "Real-time strategy game on a world map",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    orientation: "any",
    icons: [
      {
        src: "/assets/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/assets/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/assets/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
