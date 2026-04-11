import html from "./site.html";
import ogImageSvg from "./og-image.svg";

// Base64-encode the PNG at build time isn't possible with text modules,
// so we import the PNG as a binary module via a separate rule.
import ogImagePng from "./og-image.png";

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(html, {
        headers: {
          "content-type": "text/html;charset=UTF-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    if (url.pathname === "/og.png") {
      return new Response(ogImagePng, {
        headers: {
          "content-type": "image/png",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    if (url.pathname === "/og.svg") {
      return new Response(ogImageSvg, {
        headers: {
          "content-type": "image/svg+xml",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    return Response.redirect(new URL("/", request.url).toString(), 301);
  },
};
