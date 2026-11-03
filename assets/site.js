/* QLTYSTNC — content loader
   Reads content written via the /admin panel (Decap CMS) directly from the
   public GitHub repo and renders it on the site. No build step needed.
*/
(function () {
  var REPO_OWNER = "qltystnc-lab";
  var REPO_NAME = "qltystnc-site";
  var BRANCH = "main";

  var TREE_URL = "https://api.github.com/repos/" + REPO_OWNER + "/" + REPO_NAME + "/git/trees/" + BRANCH + "?recursive=1";
  // raw.githubusercontent.com updates within ~5 minutes of a change (no more manual jsDelivr cache purges)
  var RAW_BASE = "https://raw.githubusercontent.com/" + REPO_OWNER + "/" + REPO_NAME + "/" + BRANCH + "/";

  // ---------- frontmatter + markdown ----------

  function unquote(v) {
    var dq = v.match(/^"([\s\S]*)"$/);
    if (dq) return dq[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    var sq = v.match(/^'([\s\S]*)'$/);
    if (sq) return sq[1].replace(/''/g, "'");
    return v;
  }

  function parseFrontmatter(text) {
    var m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!m) return { data: {}, body: text };
    var lines = m[1].split("\n");
    var body = m[2];
    var data = {};
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var km = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
      if (!km) { i++; continue; }
      var key = km[1];
      var val = km[2].trim();
      i++;
      var block = val.match(/^([|>])[-+]?$/);
      if (block) {
        // YAML block text (used for long texts like body_en): keep line breaks for "|", fold for ">"
        var raw = [];
        while (i < lines.length && (lines[i].trim() === "" || /^\s/.test(lines[i]))) { raw.push(lines[i]); i++; }
        while (raw.length && raw[raw.length - 1].trim() === "") raw.pop();
        var indent = Infinity;
        raw.forEach(function (l) { if (l.trim()) indent = Math.min(indent, l.match(/^\s*/)[0].length); });
        if (indent === Infinity) indent = 0;
        raw = raw.map(function (l) { return l.slice(indent); });
        if (block[1] === "|") {
          data[key] = raw.join("\n");
        } else {
          data[key] = raw.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ");
        }
        continue;
      }
      // plain value, possibly wrapped over several indented lines
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*-\s/.test(lines[i])) {
        val += " " + lines[i].trim();
        i++;
      }
      data[key] = unquote(val);
    }
    return { data: data, body: body.trim() };
  }

  // ---- Language (PT / EN) ----
  function getLang() {
    try { return localStorage.getItem("qltystnc-lang") === "en" ? "en" : "pt"; } catch (e) { return "pt"; }
  }
  // pick the English field when the reader chose EN and it exists, otherwise Portuguese
  function pick(d, field, lang) {
    if (lang === "en" && d[field + "_en"] && String(d[field + "_en"]).trim()) return d[field + "_en"];
    return d[field];
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
    s = s.replace(/\\([*_~|\-#>.!\[\]()])/g, "$1");
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
    return s;
  }

  function markdownToHtml(md) {
    // normalize stray backslash-escapes before splitting into blocks
    md = md.replace(/\\([*_~|\-#>.!\[\]()])/g, "$1");
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
      "<h3" + (d.title_en ? ' data-pt="' + esc(d.title || "") + '" data-en="' + esc(d.title_en) + '"' : "") + ">" +
        esc(pick(d, "title", getLang()) || "Sem título") + "</h3>" +
      '<div class="meta"' + (d.subtitulo_en && !d.localizacao ? ' data-pt="' + esc((d.subtitulo || "").toUpperCase()) + '" data-en="' + esc(d.subtitulo_en.toUpperCase()) + '"' : "") + ">" +
        esc((d.localizacao ? metaLabel : (pick(d, "subtitulo", getLang()) || metaLabel) || "").toUpperCase()) + "</div>" +
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

  var _postEntry = null;
  function postHtml(entry, lang) {
    var d = entry.data;
    var hasEn = !!(d.body_en && String(d.body_en).trim());
    var useEn = lang === "en" && hasEn;
    var title = useEn ? (d.title_en || d.title) : d.title;
    var sub = useEn ? (d.subtitulo_en || d.subtitulo) : d.subtitulo;
    var body = useEn ? d.body_en : entry.body;
    var coverHtml = d.capa
      ? '<div class="post-cover">' + imgTag(d.capa, title || "", "width:100%;display:block;", true) + "</div>"
      : "";
    var notice = (lang === "en" && !hasEn)
      ? '<div class="lang-notice mono">English version coming soon — showing the original Portuguese text.</div>'
      : "";
    var creditsHtml = d.creditos
      ? '<div class="post-credits mono">' + esc(d.creditos.toUpperCase()) + "</div>"
      : "";
    return (
      '<div class="eyebrow mono">' + fmtDate(d.date) + (d.tipo ? " · " + esc(String(d.tipo).toUpperCase()) : "") + "</div>" +
      '<h1 class="post-title">' + esc(title || "") + "</h1>" +
      (sub ? '<p class="post-sub">' + esc(sub) + "</p>" : "") +
      notice +
      coverHtml +
      '<div class="article-body">' + markdownToHtml(body || "") + "</div>" +
      creditsHtml
    );
  }

  function renderPost(lang) {
    var params = new URLSearchParams(window.location.search);
    var type = params.get("type");
    var slug = params.get("slug");
    var root = document.getElementById("post-root");
    if (!root || !type || !slug) return;
    lang = lang || getLang();

    if (_postEntry) {
      root.innerHTML = postHtml(_postEntry, lang);
      document.title = (pick(_postEntry.data, "title", lang) || "QLTYSTNC") + " — QLTYSTNC";
      return;
    }
    getCollection(type).then(function (entries) {
      var entry = entries.filter(function (e) { return e.slug === slug; })[0];
      if (!entry) {
        root.innerHTML = '<p class="mono" style="color:var(--mute)">Conteúdo não encontrado.</p>';
        return;
      }
      _postEntry = entry;
      renderPost(getLang());
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
    var startOfEventDay = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    // compare calendar days only (event time of day no longer adds an extra day)
    return Math.round((startOfEventDay - startOfToday) / (1000 * 60 * 60 * 24));
  }

  function eventRowHtml(entry, isNext, isPast) {
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
          (wereGoing ? '<span class="mono ev-badge">' + (isPast ? "ESTIVEMOS LÁ" : "VAMOS ESTAR LÁ") + "</span>" : "") +
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
          ? past.map(function (e) { return eventRowHtml(e, false, true); }).join("")
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

  // ---------- Arquivo (todas as reportagens + sessões) ----------
  var _archivePromise = null;
  function renderArchive(containerId, filter, countId) {
    var el = document.getElementById(containerId);
    if (!el) return;
    if (!_archivePromise) {
      _archivePromise = Promise.all(["reportagens", "sessoes"].map(getCollection)).then(function (r) {
        var all = [].concat.apply([], r);
        all.sort(function (a, b) {
          return new Date(b.data.date || 0).getTime() - new Date(a.data.date || 0).getTime();
        });
        return all;
      });
    }
    _archivePromise.then(function (entries) {
      if (filter && filter !== "todos") {
        entries = entries.filter(function (e) { return e.type === filter; });
      }
      var countEl = countId && document.getElementById(countId);
      if (countEl) countEl.textContent = String(entries.length).padStart(2, "0");
      el.innerHTML = entries.length
        ? entries.map(function (e) { return cardHtml(e, false); }).join("")
        : '<p class="mono" style="color:var(--mute);font-size:13px;">Ainda não há nada publicado aqui.</p>';
    });
  }

  window.QLTYSTNC = {
    renderArchive: renderArchive,
    renderGrid: renderGrid,
    renderMixedGrid: renderMixedGrid,
    renderPost: renderPost,
    getLang: getLang,
    renderCalendar: renderCalendar,
    renderStore: renderStore,
    renderMaterial: renderMaterial
  };
})();
