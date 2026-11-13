/* Minimaler, sicherer Markdown-Renderer.
   Alles wird zuerst HTML-escaped, danach werden nur bekannte Muster in Tags umgewandelt.
   Links nur mit http(s). Kein innerHTML mit Rohtext. */
(function (root) {
  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInline(escapedText) {
    const codeSpans = [];
    let text = escapedText.replace(/`([^`\n]+)`/g, (_, code) => {
      codeSpans.push(code);
      return `\u0000${codeSpans.length - 1}\u0000`;
    });
    text = text.replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
      (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
    );
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    text = text.replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${codeSpans[Number(index)]}</code>`);
    return text;
  }

  const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
  const isTableSeparator = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
  const splitRow = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());

  function renderTable(header, rows) {
    const head = `<tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr>`;
    const body = rows
      .map((row) => `<tr>${header.map((_, index) => `<td>${renderInline(row[index] || "")}</td>`).join("")}</tr>`)
      .join("");
    return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  }

  function renderMarkdown(source) {
    const lines = escapeHtml(source || "").split("\n");
    const html = [];
    let paragraph = [];
    let listType = null;
    let inCode = false;
    let codeLines = [];

    const flushParagraph = () => {
      if (paragraph.length) {
        html.push(`<p>${renderInline(paragraph.join("<br>"))}</p>`);
        paragraph = [];
      }
    };
    const closeList = () => {
      if (listType) {
        html.push(`</${listType}>`);
        listType = null;
      }
    };

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (/^\s*```/.test(line)) {
        if (inCode) {
          html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
          codeLines = [];
          inCode = false;
        } else {
          flushParagraph();
          closeList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (isTableRow(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
        flushParagraph();
        closeList();
        const header = splitRow(line);
        const rows = [];
        index += 2;
        while (index < lines.length && isTableRow(lines[index])) rows.push(splitRow(lines[index++]));
        index--;
        html.push(renderTable(header, rows));
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
      const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
      const quote = line.match(/^&gt;\s?(.*)$/);

      if (heading) {
        flushParagraph();
        closeList();
        const level = Math.min(heading[1].length + 2, 6);
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      } else if (bullet || numbered) {
        flushParagraph();
        const wanted = bullet ? "ul" : "ol";
        if (listType !== wanted) {
          closeList();
          html.push(`<${wanted}>`);
          listType = wanted;
        }
        html.push(`<li>${renderInline((bullet || numbered)[1])}</li>`);
      } else if (quote) {
        flushParagraph();
        closeList();
        html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        flushParagraph();
        closeList();
        html.push("<hr>");
      } else if (line.trim() === "") {
        flushParagraph();
        closeList();
      } else {
        closeList();
        paragraph.push(line);
      }
    }
    if (inCode) html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
    flushParagraph();
    closeList();
    return html.join("");
  }

  root.renderMarkdown = renderMarkdown;
  if (typeof module !== "undefined" && module.exports) module.exports = { renderMarkdown };
})(typeof window !== "undefined" ? window : globalThis);
