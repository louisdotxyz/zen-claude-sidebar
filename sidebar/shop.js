/* Shopping: Produktdaten kompakt aus Seiten holen (offene Tabs und abgerufene Seiten).
   Ziel: wenige Tokens. Statt des ganzen Seitentexts gehen strukturierte Angaben
   (JSON-LD, Meta-Tags) und kurze Produktkarten an Claude. */
(function (root) {
  const FETCH_TIMEOUT_MS = 12000;
  const MAX_DETAIL_URLS = 6;
  const BOT_CHECK = /kurze prüfung|captcha|just a moment|attention required|access denied|are you a robot|bot.?(check|schutz|protection)|zugriff verweigert/i;

  /* Läuft auf einem beliebigen Document (im Tab oder per DOMParser). Muss in sich geschlossen sein,
     weil es als Text in Tabs eingeschleust wird. owned = Document darf verändert werden. */
  function extractShopData(doc, baseUrl, owned) {
    const clean = (value, max) => String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max || 300);
    const absolute = (href) => {
      try {
        return new URL(href, baseUrl).href;
      } catch (_) {
        return "";
      }
    };
    const prune = (object) => {
      for (const key of Object.keys(object)) {
        if (object[key] === undefined || object[key] === null || object[key] === "") delete object[key];
      }
      return object;
    };

    /* JSON-LD (schema.org): Product, Offer, AggregateOffer, ItemList */
    const nodes = [];
    const walk = (value, depth) => {
      if (!value || typeof value !== "object" || depth > 6) return;
      if (Array.isArray(value)) return value.forEach((item) => walk(item, depth + 1));
      nodes.push(value);
      ["@graph", "itemListElement", "item", "mainEntity", "hasVariant", "isVariantOf"].forEach((key) => walk(value[key], depth + 1));
    };
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        walk(JSON.parse(script.textContent), 0);
      } catch (_) {
        /* kaputtes JSON-LD ignorieren */
      }
    });
    const isType = (node, type) => [].concat(node["@type"] || []).some((entry) => String(entry).toLowerCase() === type);
    const shortSchema = (value) => clean(value, 40).replace(/^https?:\/\/schema\.org\//i, "");
    const readOffer = (offers) => {
      const list = [].concat(offers || []).filter((offer) => offer && typeof offer === "object");
      if (!list.length) return {};
      const offer = list[0];
      if (isType(offer, "aggregateoffer")) {
        return { price: offer.lowPrice || offer.price, highPrice: offer.highPrice, currency: offer.priceCurrency, offers: offer.offerCount, availability: shortSchema(offer.availability) };
      }
      const spec = [].concat(offer.priceSpecification || [])[0] || {};
      return {
        price: offer.price != null ? offer.price : spec.price,
        currency: offer.priceCurrency || spec.priceCurrency,
        availability: shortSchema(offer.availability),
        seller: offer.seller && clean(offer.seller.name, 60),
        offers: list.length > 1 ? list.length : undefined
      };
    };
    const seenProducts = new Set();
    const products = [];
    for (const node of nodes) {
      if (!isType(node, "product") || products.length >= 40) continue;
      const offer = readOffer(node.offers);
      const rating = node.aggregateRating || {};
      const brand = node.brand && typeof node.brand === "object" ? node.brand.name : node.brand;
      const product = prune({
        name: clean(node.name, 160),
        brand: clean(brand, 60),
        gtin: clean(node.gtin13 || node.gtin || node.gtin12 || node.gtin14 || node.gtin8, 20),
        mpn: clean(node.mpn, 40),
        url: node.url ? absolute(node.url) : "",
        price: offer.price != null ? String(offer.price) : "",
        highPrice: offer.highPrice != null ? String(offer.highPrice) : "",
        currency: clean(offer.currency, 5),
        availability: offer.availability,
        seller: offer.seller,
        offers: offer.offers,
        rating: rating.ratingValue != null ? String(rating.ratingValue) : "",
        reviews: rating.reviewCount != null ? String(rating.reviewCount) : rating.ratingCount != null ? String(rating.ratingCount) : "",
        description: clean(node.description, 240)
      });
      const key = `${product.name}|${product.url || ""}`;
      if (!product.name || seenProducts.has(key)) continue;
      seenProducts.add(key);
      products.push(product);
    }

    /* Meta-Tags (OpenGraph, Shop-Systeme) */
    const meta = (name) => {
      const tag = doc.querySelector(`meta[property="${name}"], meta[name="${name}"], meta[itemprop="${name}"]`);
      return tag ? clean(tag.getAttribute("content"), 200) : "";
    };
    const metaInfo = prune({
      title: meta("og:title"),
      description: meta("og:description") || meta("description"),
      price: meta("product:price:amount") || meta("og:price:amount") || meta("price"),
      currency: meta("product:price:currency") || meta("og:price:currency") || meta("priceCurrency"),
      availability: meta("product:availability") || meta("og:availability") || meta("availability")
    });

    if (owned) doc.querySelectorAll("script, style, noscript, svg, template, iframe").forEach((node) => node.remove());

    /* Produktkarten in Listen und Suchergebnissen: kleinster Block um einen Link, der einen Preis enthält. */
    const priceRe = /(CHF|Fr\.|EUR|€|\$|£)\s?\d|\d[\d'’.,]*\s?(CHF|€|EUR|\.[–-])|(^|\s)\d{1,5}[.,]\d{2}(\s|$)/;
    const textOf = (node) => clean(node.textContent, 1000);
    /* Text mit Abständen zwischen den Elementen, plus Bewertungen, die nur als aria-label da sind */
    const cardText = (node) => {
      const parts = [];
      const walker = doc.createTreeWalker(node, 4 /* NodeFilter.SHOW_TEXT */);
      while (walker.nextNode()) {
        const value = walker.currentNode.nodeValue.trim();
        if (value) parts.push(value);
      }
      node.querySelectorAll("[aria-label]").forEach((labelled) => {
        const label = clean(labelled.getAttribute("aria-label"), 60);
        if (!labelled.textContent.trim() && !/^(A|BUTTON)$/.test(labelled.tagName) && /\d/.test(label)) parts.push(label);
      });
      return clean(parts.join(" "), 240);
    };
    const linkScore = (candidate) => {
      const href = candidate.getAttribute("href") || "";
      const label = clean(candidate.getAttribute("aria-label") || candidate.getAttribute("title") || candidate.textContent, 200);
      let score = label.length;
      if (/\d{5,}/.test(href)) score += 40;
      if (/categor|kategorie|producttype|brand|marke|filter|tag\//i.test(href)) score -= 40;
      if (href.includes("?")) score -= 10;
      return score;
    };
    const cards = [];
    const usedBlocks = [];
    const links = doc.querySelectorAll("a[href]");
    for (let index = 0; index < links.length && cards.length < 40; index++) {
      const link = links[index];
      const href = absolute(link.getAttribute("href"));
      if (!/^https?:/i.test(href) || href.split("#")[0] === String(baseUrl).split("#")[0]) continue;
      if (link.closest && link.closest("nav, header, footer")) continue;
      let block = null;
      let node = link;
      for (let level = 0; level < 7 && node && node !== doc.body; level++) {
        const text = textOf(node);
        if (text.length > 600) break;
        if (priceRe.test(text) && text.replace(priceRe, "").trim().length > 12) {
          block = node;
          break;
        }
        node = node.parentElement;
      }
      if (!block || usedBlocks.some((used) => used === block || used.contains(block) || block.contains(used))) continue;
      usedBlocks.push(block);
      let best = link;
      block.querySelectorAll("a[href]").forEach((candidate) => {
        if (linkScore(candidate) > linkScore(best)) best = candidate;
      });
      let text = cardText(block);
      const name = clean(best.getAttribute("aria-label") || best.getAttribute("title"), 120);
      if (name && !text.includes(name)) text = `${name} · ${text}`;
      cards.push({ text, url: absolute(best.getAttribute("href")) || href });
    }

    /* Technische Daten aus Tabellen und Definitionslisten */
    const specs = [];
    doc.querySelectorAll("table tr, dl").forEach((row) => {
      if (specs.length >= 40) return;
      if (row.tagName === "DL") {
        const terms = row.querySelectorAll("dt");
        terms.forEach((term) => {
          const value = term.nextElementSibling;
          if (value && value.tagName === "DD" && specs.length < 40) specs.push(`${clean(term.textContent, 60)}: ${clean(value.textContent, 120)}`);
        });
        return;
      }
      const cells = row.querySelectorAll("th, td");
      if (cells.length === 2) specs.push(`${clean(cells[0].textContent, 60)}: ${clean(cells[1].textContent, 120)}`);
    });

    return {
      products,
      meta: metaInfo,
      cards: cards.length >= 3 ? cards : [],
      specs: specs.filter((line) => line.length > 4 && !/^:\s|:\s*$/.test(line))
    };
  }

  /* Kompakter Textblock für Claude. */
  function formatShopData(shop) {
    if (!shop) return "";
    const lines = [];
    const join = (parts) => parts.filter(Boolean).join(" | ");
    if (shop.products && shop.products.length) {
      lines.push("Products (structured data):");
      shop.products.forEach((product, index) => {
        lines.push(`${index + 1}. ${join([
          product.brand && !product.name.toLowerCase().includes(product.brand.toLowerCase()) ? `${product.brand} ${product.name}` : product.name,
          product.price ? `${product.currency || ""} ${product.price}${product.highPrice ? `–${product.highPrice}` : ""}`.trim() : "",
          product.availability,
          product.offers ? `${product.offers} offers` : "",
          product.rating ? `rating ${product.rating}${product.reviews ? ` (${product.reviews})` : ""}` : "",
          product.gtin ? `EAN ${product.gtin}` : "",
          product.mpn ? `MPN ${product.mpn}` : "",
          product.seller,
          product.url
        ])}`);
      });
    }
    const meta = shop.meta || {};
    if (!(shop.products && shop.products.length) && (meta.price || meta.availability)) {
      lines.push(`Page price: ${join([`${meta.currency || ""} ${meta.price || "?"}`.trim(), meta.availability])}`);
    }
    if (shop.cards && shop.cards.length) {
      lines.push("Product cards on the page (as shown, in order):");
      shop.cards.forEach((card, index) => lines.push(`${index + 1}. ${card.text} — ${card.url}`));
    }
    if (shop.specs && shop.specs.length) {
      lines.push("Specs:");
      shop.specs.forEach((line) => lines.push(`- ${line}`));
    }
    return lines.join("\n");
  }

  const hasShopData = (shop) => Boolean(shop && ((shop.products && shop.products.length) || (shop.cards && shop.cards.length)));

  async function fetchDocument(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { credentials: "omit", redirect: "follow", signal: controller.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
      const finalUrl = response.url || url;
      if (!response.ok) return { url: finalUrl, status: response.status };
      const type = response.headers.get("content-type") || "";
      if (!/html|xml/i.test(type)) return { url: finalUrl, status: response.status, error: `not a web page (${type || "unknown type"})` };
      const html = await response.text();
      return { url: finalUrl, status: response.status, doc: new DOMParser().parseFromString(html, "text/html") };
    } catch (error) {
      return { url, error: error.name === "AbortError" ? "timeout" : error.message || "fetch failed" };
    } finally {
      clearTimeout(timer);
    }
  }

  /* Eine Produktseite (Shop oder Preisvergleich) abrufen und kompakt zusammenfassen. */
  async function productDetails(url) {
    const page = await fetchDocument(url);
    if (!page.doc) {
      const gone = page.status === 404 || page.status === 410;
      return { url: page.url, error: gone ? "page not found (product probably removed)" : page.error || `HTTP ${page.status}` };
    }
    const doc = page.doc;
    const title = (doc.querySelector("title") || {}).textContent || "";
    if (BOT_CHECK.test(title)) {
      return { url: page.url, error: "blocked by the site's bot protection. If the page is open in a tab, use read_tab; otherwise try another shop." };
    }
    const shop = extractShopData(doc, page.url, true);
    const result = { url: page.url, title: title.replace(/\s+/g, " ").trim().slice(0, 160) };
    const data = formatShopData(Object.assign({}, shop, { cards: shop.cards.slice(0, 15), specs: shop.specs.slice(0, 30) }));
    result.data = data;
    if (!hasShopData(shop) && !(shop.meta && shop.meta.price)) {
      /* Kein Strukturwissen: kurzer Textauszug als Notlösung */
      const body = doc.body ? doc.body.textContent.replace(/\s+/g, " ").trim() : "";
      result.text = body.slice(0, 2500);
    } else if (shop.meta && shop.meta.description && !data.includes(shop.meta.description)) {
      result.description = shop.meta.description;
    }
    return result;
  }

  async function productDetailsMany(urls) {
    const list = [...new Set((urls || []).filter((url) => /^https?:\/\//i.test(String(url))))].slice(0, MAX_DETAIL_URLS);
    return Promise.all(list.map((url) => productDetails(url)));
  }

  root.ShopTools = { extractShopData, formatShopData, hasShopData, productDetails, productDetailsMany, MAX_DETAIL_URLS };
  if (typeof module !== "undefined" && module.exports) module.exports = root.ShopTools;
})(typeof window !== "undefined" ? window : globalThis);
