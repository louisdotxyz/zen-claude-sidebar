/* Seiteninhalte aus Tabs auslesen. */
(function (root) {
  const MAX_CHARS_PER_TAB = 60000;
  const MAX_CHARS_TOTAL = 180000;
  /* Auf Produktlisten reicht ein kurzer Seitentext: die Produkte kommen kompakt als Shop-Daten mit. */
  const MAX_CHARS_WITH_LISTING = 6000;

  /* Läuft im Tab. Holt den lesbaren Text, bevorzugt <article>/<main>. */
  function pageExtractor() {
    const pick = document.querySelector("article, main, [role=main]");
    const readText = (element) => (element ? element.innerText || "" : "");
    let text = readText(pick);
    if (text.trim().length < 600) text = readText(document.body);
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    let shop = null;
    try {
      /* eslint-disable-next-line no-undef */
      if (typeof __claudeExtractShopData === "function") shop = __claudeExtractShopData(document, location.href, false);
    } catch (_) {
      shop = null;
    }
    return {
      title: document.title || location.href,
      url: location.href,
      text,
      shop,
      selection: String(window.getSelection ? window.getSelection() : "").trim()
    };
  }

  function extractorCode() {
    const shop = root.ShopTools ? `var __claudeExtractShopData = ${root.ShopTools.extractShopData.toString()};\n` : "";
    return `${shop}(${pageExtractor.toString()})()`;
  }

  const L = (key, values) => (root.I18n ? root.I18n.t(key, values) : key);

  function isReadableUrl(url) {
    return /^(https?|file):/i.test(url || "");
  }

  async function extractTab(tab) {
    if (!isReadableUrl(tab.url)) {
      throw new Error(L("error.tabInternal", { title: tab.title || tab.url }));
    }
    try {
      const [result] = await browser.tabs.executeScript(tab.id, { code: extractorCode() });
      if (!result || (!result.text && !(root.ShopTools && root.ShopTools.hasShopData(result.shop)))) throw new Error("leer");
      return result;
    } catch (error) {
      throw new Error(L("error.tabUnreadable", { title: tab.title || tab.url }));
    }
  }

  /* Baut aus Seiteninhalten den Kontextblock für Claude. */
  function buildDocumentsBlock(pages) {
    let budget = MAX_CHARS_TOTAL;
    const parts = [];
    pages.forEach((page, index) => {
      const shopText = root.ShopTools && page.shop ? root.ShopTools.formatShopData(page.shop) : "";
      const isListing = Boolean(page.shop && page.shop.cards && page.shop.cards.length);
      let perTab = Math.min(MAX_CHARS_PER_TAB, Math.max(2000, Math.floor(budget / (pages.length - index))));
      if (isListing) perTab = Math.min(perTab, MAX_CHARS_WITH_LISTING);
      /* Produktseite mit strukturierten Daten: Preis & Co. stehen schon in shop_data */
      else if (page.shop && page.shop.products && page.shop.products.length && pages.length > 1) perTab = Math.min(perTab, 8000);
      let text = page.text || "";
      let truncated = false;
      if (text.length > perTab) {
        text = text.slice(0, perTab);
        truncated = true;
      }
      budget -= text.length;
      const selection = page.selection ? `\n<selected_text>\n${page.selection.slice(0, 5000)}\n</selected_text>` : "";
      const shopBlock = shopText ? `\n<shop_data>\n${shopText}\n</shop_data>` : "";
      parts.push(
        `<document index="${index + 1}">\n<title>${page.title}</title>\n<url>${page.url}</url>${selection}${shopBlock}\n<content>\n${text}${truncated ? "\n[… gekürzt]" : ""}\n</content>\n</document>`
      );
    });
    return parts.join("\n\n");
  }

  root.TabTools = { extractTab, buildDocumentsBlock, isReadableUrl, pageExtractor };
  if (typeof module !== "undefined" && module.exports) module.exports = root.TabTools;
})(typeof window !== "undefined" ? window : globalThis);
