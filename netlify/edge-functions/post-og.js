// Adds share previews (title, description, cover photo) to each reportagem/sessão
// so links shared on WhatsApp, Instagram, Facebook show the right photo and title.
// If anything fails, the page is served exactly as before.
const REPO_RAW = "https://raw.githubusercontent.com/qltystnc-lab/qltystnc-site/main/content/";
const TYPES = ["reportagens", "sessoes"];

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function frontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---/);
  const data = {};
  if (!m) return data;
  let last = null;
  m[1].split("\n").forEach((line) => {
    if (last && /^\s+\S/.test(line)) { data[last] = ((data[last] || "") + " " + line.trim()).trim(); return; }
    const i = line.indexOf(":");
    if (i === -1) return;
    last = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if (/^[>|][-+]?$/.test(v)) v = "";
    data[last] = v.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  });
  return data;
}

// Same resized URL that assets/site.js asks for, so the preloaded image is reused.
function optUrl(src, w) {
  return "/.netlify/images?url=" + encodeURIComponent(src) + "&w=" + w + "&q=85";
}

// Reads only the start of a JPEG (max 256 KB) to get its width/height, so the page
// can reserve the cover's exact space before it loads. Returns null if unsure.
async function jpegSize(imgUrl) {
  const r = await fetch(imgUrl, { headers: { Range: "bytes=0-262143" } });
  if (!r.ok || !r.body) return null;
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < 262144) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
  }
  try { reader.cancel(); } catch (e) {}
  const b = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { b.set(c.subarray(0, Math.min(c.length, got - o)), o); o += c.length; if (o >= got) break; }
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2, orient = 1;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    // EXIF orientation (APP1) — rotated photos swap width and height
    if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10, le = b[t] === 0x49;
      const u16 = (p) => le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1];
      const u32 = (p) => le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
      const ifd = t + u32(t + 4);
      if (ifd + 2 < b.length) {
        const n = u16(ifd);
        for (let k = 0; k < n && ifd + 2 + k * 12 + 10 < b.length; k++) {
          const e = ifd + 2 + k * 12;
          if (u16(e) === 0x0112) { orient = u16(e + 8); break; }
        }
      }
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const h = (b[i + 5] << 8) | b[i + 6], w = (b[i + 7] << 8) | b[i + 8];
      if (!w || !h) return null;
      return orient >= 5 && orient <= 8 ? { w: h, h: w } : { w, h };
    }
    i += 2 + len;
  }
  return null;
}

export default async (request, context) => {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const slug = url.searchParams.get("slug");
  const valid = TYPES.includes(type) && slug && !slug.includes("/") && !slug.includes("..");
  // fetch the article text at the same time as the page, not after it
  const mdPromise = valid
    ? fetch(REPO_RAW + type + "/" + encodeURIComponent(slug) + ".md").then((r) => (r.ok ? r.text() : null)).catch(() => null)
    : null;
  const response = await context.next();
  try {
    if (!valid) return response;

    const text = await mdPromise;
    if (!text) return response;
    const d = frontmatter(text);
    if (!d.title) return response;

    const title = d.title + " — QLTYSTNC";
    const desc = d.subtitulo || d.localizacao || "Reportagem QLTYSTNC — fotografia e cultura automóvel.";
    const cover = d.capa && /^\/uploads\/.+\.(jpe?g|png|webp)$/i.test(d.capa) ? d.capa : "/uploads/dsc07367.jpg";
    const img = url.origin + "/.netlify/images?url=" + encodeURIComponent(cover) + "&w=1200&h=630&fit=cover&q=80";

    const tags =
      "<title>" + esc(title) + "</title>\n" +
      '<meta name="description" content="' + esc(desc) + '">\n' +
      '<meta property="og:type" content="article">\n' +
      '<meta property="og:site_name" content="QLTYSTNC">\n' +
      '<meta property="og:title" content="' + esc(title) + '">\n' +
      '<meta property="og:description" content="' + esc(desc) + '">\n' +
      '<meta property="og:url" content="' + esc(url.href) + '">\n' +
      '<meta property="og:image" content="' + esc(img) + '">\n' +
      '<meta property="og:image:width" content="1200">\n' +
      '<meta property="og:image:height" content="630">\n' +
      '<meta property="og:locale" content="pt_PT">\n' +
      '<meta name="twitter:card" content="summary_large_image">';

    // Speed: start downloading the cover straight away, and hand the article text to
    // the page so it doesn't have to fetch it again from GitHub.
    let speed = "";
    if (d.capa && /^\/uploads\/.+\.(jpe?g|png|webp)$/i.test(d.capa)) {
      const srcset = [800, 1200, 1600, 2400].map((w) => optUrl(d.capa, w) + " " + w + "w").join(", ");
      speed += '\n<link rel="preload" as="image" href="' + esc(optUrl(d.capa, 1600)) + '" imagesrcset="' + esc(srcset) +
        '" imagesizes="(max-width: 760px) 100vw, 760px" fetchpriority="high">';
      if (/\.jpe?g$/i.test(d.capa)) {
        try {
          const size = await Promise.race([
            jpegSize(url.origin + encodeURI(d.capa)),
            new Promise((res) => setTimeout(() => res(null), 600)),
          ]);
          if (size) speed += "\n<style>:root{--cover-ar:" + size.w + "/" + size.h + "}</style>";
        } catch (e) {}
      }
    }
    speed += '\n<script type="application/json" id="post-md">' +
      JSON.stringify({ type, slug, text }).replace(/</g, "\\u003c") + "</script>";

    const html = await response.text();
    if (!html.includes("<title>QLTYSTNC</title>")) return new Response(html, response);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(html.replace("<title>QLTYSTNC</title>", tags + speed), { status: response.status, headers });
  } catch (e) {
    return response;
  }
};

export const config = { path: ["/post", "/post.html"] };
