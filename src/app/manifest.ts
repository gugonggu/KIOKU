import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/", name: "KIOKU 여행 수첩", short_name: "KIOKU", lang: "ko",
    start_url: "/trips", scope: "/", display: "standalone",
    background_color: "#f6f3ec", theme_color: "#f6f3ec",
    icons: [
      { src: "/kioku-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/kioku-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/kioku-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
