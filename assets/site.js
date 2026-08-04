/* QLTYSTNC — content loader
   Reads content written via the /admin panel (Decap CMS) directly from the
   public GitHub repo and renders it on the site. No build step needed.
*/
(function () {
  var REPO_OWNER = "qltystnc-lab";
  var REPO_NAME = "qltystnc-site";
  var BRANCH = "main";

  var TREE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/git/trees/" + BRANCH + "?recursive=1";
  var RAW_BASE = "https://cdn.jsdelivr.net/gh/" + REPO_OWNER + "/" + REPO_NAME + "@" + BRANCH + "/";

  // ---------- frontmatter + markdown ----------

  function parseFrontmatter(text) {
    var m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!m) return { data: {}, body: text };
    var raw = m[1];
    var body = m[2];
    var data = {};
    raw.split("\n").forEach(function (line) {
      var idx = line.indexOf(":");
      if (idx === -1) return;
      var key = line.slice(0, idx).trim();
      var val = line.slice(idx + 1).trim();
      val = val.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      data[key] = val;
    });
    return { data: data, body: body.trim() };
  }

  function inlineMd(s) {
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    return s;
  }

  function markdownToHtml(md) {
    var blocks = md.split(/\n\s*\n/);
    var html = blocks.map(function (block) {
      block = block.trim();
      if (!block) return "";
      if (block.indexOf(">") === 0) {
        var quote = block.replace(/^>\s?/gm, "");
        return "<blockquote>" + inlineMd(quote) + "</blockquote>";
      }
      if (/^-\s+/.test(block)) {
        var items = block.split("\n").map(function (l) {
          return "<li>" + inlineMd(l.replace(/^-\s+/, "")) + "</li>";
        }).join("");
        return "<ul>" + items + "</ul>";
      }
      if (/^\*\*(.+)\*\*$/.test(block) && block.split("\n").length === 1) {
        return "<h3>" + inlineMd(block.replace(/\*\*/g, "")) + "</h3>";
      }
      return "<p>" + inlineMd(block).replace(/\n/g, "<br>") + "</p>";
    }).join("\n");
    return html;
  }

  // ---------- data fetching ----------

  var _treePromise = null;
  function getTree() {
    if (!_treePromise) {
      _treePromise = fetch(TREE_URL).then(function (r) {
        if (!r.ok) throw new Error("tree fetch failed");
        return r.json();
      });
    }
    return _treePromise;
  }

  function getCollection(type) {
    return getTree().then(function (tree) {
      var prefix = "content/" + type + "/";
      var files = tree.tree.filter(function (item) {
        return item.type === "blob" && item.path.indexOf(prefix) === 0 && item.path.endsWith(".md");
      });
      return Promise.all(files.map(function (f) {
        var slug = f.path.replace(prefix, "").replace(/\.md$/, "");
        return fetch(RAW_BASE + f.path).then(function (r) { return r.text(); }).then(function (text) {
          var parsed = parseFrontmatter(text);
          return {
            slug: slug,
            type: type,
            data: parsed.data,
            body: parsed.body
          };
        });
      }));
    }).then(function (entries) {
      entries.sort(function (a, b) {
        var da = new Date(a.data.date || 0).getTime();
        var db = new Date(b.data.date || 0).getTime();
        return db - da;
      });
      return entries;
    }).catch(function (err) {
      console.warn("QLTYSTNC content: could not load " + type, err);
      return [];
    });
  }

  // ---------- rendering ----------

  function fmtDate(d) {
    if (!d) return "";
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    var dd = String(dt.getDate()).padStart(2, "0");
    var mm = String(dt.getMonth() + 1).padStart(2, "0");
    return dd + "/" + mm + "/" + dt.getFullYear();
  }

  function cardHtml(entry, featured) {
    var d = entry.data;
    var href = "post.html?type=" + entry.type + "&slug=" + encodeURIComponent(entry.slug);
    var tagLabel = d.tipo || fmtDate(d.date) || "";
    var metaLabel = d.localizacao || d.subtitulo || d.creditos || "";
    return (
      '<a href="' + href + '" class="card' + (featured ? " feature" : "") + '">' +
      '<div class="tag-sm mono">' + (tagLabel || "").toUpperCase() + "</div>" +
      "<h3>" + (d.title || "Sem título") + "</h3>" +
      '<div class="meta">' + (metaLabel || "").toUpperCase() + "</div>" +
      "</a>"
    );
  }

  function renderGrid(containerId, type, limit) {
    var el = document.getElementById(containerId);
    if (!el) return;
    getCollection(type).then(function (entries) {
      if (!entries.length) return;
      var slice = entries.slice(0, limit || 3);
      el.innerHTML = slice.map(function (entry, i) {
        return cardHtml(entry, i === 0);
      }).join("");
    });
  }

  function renderPost() {
    var params = new URLSearchParams(window.location.search);
    var type = params.get("type");
    var slug = params.get("slug");
    var root = document.getElementById("post-root");
    if (!root || !type || !slug) return;

    getCollection(type).then(function (entries) {
      var entry = entries.filter(function (e) { return e.slug === slug; })[0];
      if (!entry) {
        root.innerHTML = '<p class="mono" style="color:var(--mute)">Conteúdo não encontrado.</p>';
        return;
      }
      var d = entry.data;
      document.title = (d.title || "QLTYSTNC") + " — QLTYSTNC";
      var coverHtml = d.capa
        ? '<img src="' + d.capa + '" alt="" style="width:100%;border:1px solid var(--line);margin-bottom:32px;">'
        : "";
      var subHtml = d.subtitulo
        ? '<p class="sub" style="color:var(--mute);font-size:16px;margin-bottom:24px;">' + d.subtitulo + "</p>"
        : "";
      var creditsHtml = d.creditos
        ? '<div class="mono" style="margin-top:40px;padding-top:20px;border-top:1px solid var(--line);color:var(--mute);font-size:11px;">' + d.creditos.toUpperCase() + "</div>"
        : "";
      root.innerHTML =
        '<div class="eyebrow mono">' + fmtDate(d.date) + "</div>" +
        "<h1 style=\"font-size:clamp(28px,5vw,48px);line-height:1.05;margin-bottom:16px;\">" + (d.title || "") + "</h1>" +
        subHtml +
        coverHtml +
        '<div class="article-body">' + markdownToHtml(entry.body) + "</div>" +
        creditsHtml;
    });
  }

  window.QLTYSTNC = {
    renderGrid: renderGrid,
    renderPost: renderPost
  };
})();
