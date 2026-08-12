import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FASTDO ATTEND",
    short_name: "FASTDO",
    description: "Chấm công thông minh bằng khuôn mặt, vị trí và hiện diện tại cơ sở.",
    start_url: "/",
    display: "standalone",
    background_color: "#070909",
    theme_color: "#ff5a00",
    lang: "vi",
    orientation: "portrait",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
