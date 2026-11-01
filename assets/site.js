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
    var lastKey = null;
    raw.split("\n").forEach(function (line) {
      // continuation of a long value folded over several lines (YAML ">-", "|" or plain wrap)
      if (lastKey && /^\s+\S/.test(line) && !/^\s*-\s/.test(line)) {
        var cont = line.trim().replace(/^"(.*)"$/, "$1");
        data[lastKey] = data[lastKey] ? data[lastKey] + " " + cont : cont;
        return;
      }
      var idx = line.indexOf(":");
      if (idx === -1) return;
      var key = line.slice(0, idx).trim();
      var val = line.slice(idx + 1).trim();
      if (/^[>|][-+]?$/.test(val)) val = "";
      val = val.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
      data[key] = val;
      lastKey = key;
    });
    return { data: data, body: body.trim() };
  }

  // ---- Image optimisation (Netlify Image CDN) ----
  // Originals in /uploads stay untouched; the browser receives a resized
  // WebP/AVIF version sized for the screen. Falls back to the original on error.
  function optUrl(src, w) {
    if (!src || !/^\/uploads\/.+\.(jpe?g|png|webp)$/i.test(src)) return src;
    return "/.netlify/images?url=" + encodeURIComponent(src) + "&w=" + w + "&q=85";
  }
  function imgTag(src, alt, style, eager) {
    var opt = optUrl(src, 1600);
    var attrs = ' alt="' + (alt || "") + '" style="' + style + '"' +
      (eager ? ' fetchpriority="high"' : ' loading="lazy"') + ' decoding="async"';
    if (opt === src) return '<img src="' + src + '"' + attrs + '>';
    var srcset = [800, 1200, 1600, 2400].map(function (w) { return optUrl(src, w) + " " + w + "w"; }).join(", ");
    return '<img src="' + opt + '" srcset="' + srcset + '" sizes="(max-width: 760px) 100vw, 760px"' + attrs +
      ' onerror="this.onerror=null;this.removeAttribute(\'srcset\');this.src=\'' + src + '\'">';
  }

  function inlineMd(s) {
    // clean up stray backslash-escapes that some editors insert
    s = s.replace(/\\([*_~|])/g, "$1");
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    return s;
  }

  function markdownToHtml(md) {
    // normalize stray backslash-escapes before splitting into blocks
    md = md.replace(/\\([*_~|])/g, "$1");
    var blocks = md.split(/\n\s*\n/);
    var html = blocks.map(function (block) {
      block = block.trim();
      if (!block) return "";
      // standalone image: ![alt](src)
      var imgOnly = block.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgOnly) {
        return imgTag(imgOnly[2], imgOnly[1], "width:100%;border:1px solid var(--line);margin:8px 0;");
      }
      // headings: "## Title" or "### Title"
      var heading = block.match(/^#{1,4}\s+(.+)$/);
      if (heading && block.split("\n").length === 1) {
        return "<h3>" + inlineMd(heading[1]) + "</h3>";
      }
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
      // inline images mixed with text, or plain paragraph
      var withImages = block.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (m, alt, src) {
        return imgTag(src, alt, "width:100%;border:1px solid var(--line);margin:8px 0;");
      });
      if (withImages !== block) {
        return withImages.split("\n").map(function(line){
          return line.indexOf("<img") === 0 ? line : "<p>" + inlineMd(line) + "</p>";
        }).join("\n");
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
    // type: "reportagens" | "sessoes"
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
      // entries marked as draft in the CMS never show on the site
      // (add &preview=1 to a post link to see a draft before publishing it)
      var showDrafts = /[?&]preview=1(&|$)/.test(location.search);
      entries = entries.filter(function (e) { return showDrafts || String(e.data.rascunho) !== "true"; });
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
    var hasCover = !!d.capa;
    var bgStyle = hasCover
      ? ' style="background-image:url(\'' + optUrl(d.capa, 900) + '\');background-size:cover;background-position:center;"'
      : "";
    var coverClass = hasCover ? " has-cover" : "";
    return (
      '<a href="' + href + '" class="card' + (featured ? " feature" : "") + coverClass + '"' + bgStyle + '>' +
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
      if (!entries.length) return; // keep existing static fallback cards
      var slice = entries.slice(0, limit || 3);
      el.innerHTML = slice.map(function (entry, i) {
        return cardHtml(entry, i === 0);
      }).join("");
    });
  }

  function renderMixedGrid(containerId, types, limit) {
    var el = document.getElementById(containerId);
    if (!el) return;
    Promise.all(types.map(getCollection)).then(function (results) {
      var entries = [].concat.apply([], results);
      entries.sort(function (a, b) {
        var da = new Date(a.data.date || 0).getTime();
        var db = new Date(b.data.date || 0).getTime();
        return db - da;
      });
      if (!entries.length) return; // keep existing static fallback cards
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
        ? imgTag(d.capa, d.title || "", "width:100%;border:1px solid var(--line);margin-bottom:32px;", true)
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

  function fmtDateShort(d) {
    if (!d) return "";
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return "";
    var dd = String(dt.getDate()).padStart(2, "0");
    var mm = String(dt.getMonth() + 1).padStart(2, "0");
    return dd + "/" + mm;
  }

  function daysUntil(d) {
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return null;
    var now = new Date();
    var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.ceil((dt - startOfToday) / (1000 * 60 * 60 * 24));
    return diff;
  }

  function eventRowHtml(entry, isNext) {
    var d = entry.data;
    var isPT = (d.pais || "Portugal") === "Portugal";
    var countryColor = isPT ? "var(--signal)" : "var(--sea)";
    var dateLabel = fmtDateShort(d.date) + (d.date_fim ? " – " + fmtDateShort(d.date_fim) : "");
    var wereGoing = String(d.vamos) === "true";
    var countdown = isNext ? daysUntil(d.date) : null;
    var countdownHtml = (countdown !== null && countdown >= 0)
      ? '<div class="mono" style="font-size:10px;color:' + countryColor + ';margin-top:6px;">' +
          (countdown === 0 ? "É HOJE" : countdown === 1 ? "FALTA 1 DIA" : "FALTAM " + countdown + " DIAS") +
        "</div>"
      : "";
    var linkOpen = d.link ? '<a href="' + d.link + '" target="_blank" class="ev-row">' : '<div class="ev-row">';
    var linkClose = d.link ? "</a>" : "</div>";
    return (
      linkOpen +
      '<div class="ev-date mono" style="color:' + countryColor + ';">' + dateLabel + "</div>" +
      '<div class="ev-body">' +
        '<div class="ev-top">' +
          '<span class="ev-country-dot" style="background:' + countryColor + ';"></span>' +
          '<span class="mono" style="font-size:10px;color:var(--mute);">' + (d.tipo || "").toUpperCase() + "</span>" +
          (wereGoing ? '<span class="mono ev-badge">QLTYSTNC LÁ</span>' : "") +
        "</div>" +
        "<h3>" + (d.title || "") + "</h3>" +
        '<div class="meta">' + (d.localizacao || "").toUpperCase() + (!isPT ? " · " + (d.pais_nome ? d.pais_nome.toUpperCase() : "ESTRANGEIRO") : "") + "</div>" +
        countdownHtml +
      "</div>" +
      linkClose
    );
  }

  function renderCalendar(upcomingId, pastId, filter) {
    var upEl = document.getElementById(upcomingId);
    var pastEl = document.getElementById(pastId);
    if (!upEl) return;
    getCollection("eventos").then(function (entries) {
      if (filter && filter !== "todos") {
        var wantPT = filter === "portugal";
        entries = entries.filter(function (e) {
          return ((e.data.pais || "Portugal") === "Portugal") === wantPT;
        });
      }
      var now = new Date();
      var upcoming = entries.filter(function (e) {
        var end = e.data.date_fim ? new Date(e.data.date_fim) : new Date(e.data.date);
        return end >= now;
      }).sort(function (a, b) {
        return new Date(a.data.date) - new Date(b.data.date);
      });
      var past = entries.filter(function (e) {
        var end = e.data.date_fim ? new Date(e.data.date_fim) : new Date(e.data.date);
        return end < now;
      }).sort(function (a, b) {
        return new Date(b.data.date) - new Date(a.data.date);
      });

      upEl.innerHTML = upcoming.length
        ? upcoming.map(function (e, i) { return eventRowHtml(e, i === 0); }).join("")
        : '<p class="mono" style="color:var(--mute);font-size:13px;">Sem eventos agendados de momento.</p>';

      if (pastEl) {
        pastEl.innerHTML = past.length
          ? past.map(function (e) { return eventRowHtml(e, false); }).join("")
          : '<p class="mono" style="color:var(--mute);font-size:13px;">Sem eventos passados registados.</p>';
        pastEl.style.opacity = "0.55";
      }
    });
  }

  function productCardHtml(entry) {
    var d = entry.data;
    var hasCover = !!d.foto;
    var bgStyle = hasCover
      ? ' style="background-image:url(\'' + optUrl(d.foto, 900) + '\');background-size:cover;background-position:center;"'
      : "";
    var coverClass = hasCover ? " has-cover" : "";
    var primaryLink = d.link_paypal || d.link_stripe;
    var primaryLabel = d.link_paypal ? "COMPRAR VIA PAYPAL →" : "COMPRAR →";
    var primaryBtn = primaryLink
      ? '<a href="' + primaryLink + '" target="_blank" class="buy-btn stripe" onclick="event.stopPropagation();">' + primaryLabel + "</a>"
      : "";
    var secondaryBtn = (d.link_paypal && d.link_stripe)
      ? '<a href="' + d.link_stripe + '" target="_blank" class="buy-btn paypal" onclick="event.stopPropagation();">CARTÃO / MB WAY</a>'
      : "";
    return (
      '<div class="card' + coverClass + '"' + bgStyle + '>' +
      '<div class="tag-sm mono">' + (d.linha || "").toUpperCase() + "</div>" +
      "<h3>" + (d.title || "Sem título") + "</h3>" +
      (d.preco ? '<div class="price">' + d.preco + "€</div>" : "") +
      '<div class="meta" style="margin-bottom:12px;">' + (d.subtitulo || "").toUpperCase() + "</div>" +
      '<div class="buy-row">' + primaryBtn + secondaryBtn + "</div>" +
      "</div>"
    );
  }

  function renderStore(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    getCollection("produtos").then(function (entries) {
      if (!entries.length) {
        el.innerHTML = '<p class="mono" style="color:var(--mute);font-size:13px;">Sem produtos disponíveis de momento.</p>';
        return;
      }
      el.innerHTML = entries.map(productCardHtml).join("");
    });
  }

  // ---------- O nosso material ----------
  var MATERIAL_CATS = ["Câmara", "Lentes", "Filtros", "Estabilização", "Impressão", "Edição", "Acessórios"];

  function esc(v) {
    return String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function gearCardHtml(entry) {
    var d = entry.data;
    var img = d.foto
      ? '<div class="gear-img" style="background-image:url(\'' + optUrl(d.foto, 700) + '\');"></div>'
      : "";
    var btn = d.link
      ? '<a href="' + esc(d.link) + '" target="_blank" rel="sponsored nofollow noopener" class="gear-btn">VER NA ' + esc((d.loja || "loja").toUpperCase()) + " →</a>"
      : '<span class="gear-btn soon">LINK EM BREVE</span>';
    return (
      '<div class="gear-card">' + img +
        '<div class="gear-body">' +
          '<div class="gear-who mono">' + esc((d.quem || "").toUpperCase()) + "</div>" +
          "<h3>" + esc(d.title) + "</h3>" +
          "<p>" + esc(d.descricao) + "</p>" +
          btn +
        "</div>" +
      "</div>"
    );
  }

  function renderMaterial(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    getCollection("material").then(function (entries) {
      if (!entries.length) {
        el.innerHTML = '<p class="mono" style="color:var(--mute);font-size:13px;">Lista em preparação.</p>';
        return;
      }
      var cats = MATERIAL_CATS.slice();
      entries.forEach(function (e) { if (cats.indexOf(e.data.categoria) === -1) cats.push(e.data.categoria || "Outros"); });
      el.innerHTML = cats.map(function (cat) {
        var items = entries.filter(function (e) { return (e.data.categoria || "Outros") === cat; })
          .sort(function (a, b) { return (parseInt(a.data.ordem, 10) || 99) - (parseInt(b.data.ordem, 10) || 99); });
        if (!items.length) return "";
        return '<div class="section-title mono">' + esc(cat) + '</div><div class="gear-grid">' + items.map(gearCardHtml).join("") + "</div>";
      }).join("");
    }).catch(function () {
      el.innerHTML = '<p class="mono" style="color:var(--mute);font-size:13px;">Não foi possível carregar a lista. Tenta novamente daqui a pouco.</p>';
    });
  }

  window.QLTYSTNC = {
    renderGrid: renderGrid,
    renderMixedGrid: renderMixedGrid,
    renderPost: renderPost,
    renderCalendar: renderCalendar,
    renderStore: renderStore,
    renderMaterial: renderMaterial
  };
})();
