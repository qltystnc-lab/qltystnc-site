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

export default async (request, context) => {
  const response = await context.next();
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const slug = url.searchParams.get("slug");
    if (!TYPES.includes(type) || !slug || slug.includes("/") || slug.includes("..")) return response;

    const md = await fetch(REPO_RAW + type + "/" + encodeURIComponent(slug) + ".md");
    if (!md.ok) return response;
    const d = frontmatter(await md.text());
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

    const html = await response.text();
    if (!html.includes("<title>QLTYSTNC</title>")) return new Response(html, response);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(html.replace("<title>QLTYSTNC</title>", tags), { status: response.status, headers });
  } catch (e) {
    return response;
  }
};

export const config = { path: ["/post", "/post.html"] };
