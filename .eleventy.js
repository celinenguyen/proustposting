const { DateTime } = require("luxon");
const cheerio = require("cheerio");

module.exports = function(eleventyConfig) {
  // Date filter - handles various date formats
  eleventyConfig.addFilter("date", (dateObj, format) => {
    if (!dateObj) return "";
    // Try ISO format first, then RFC 2822 (RSS format), then JS Date
    let dt = DateTime.fromISO(dateObj);
    if (!dt.isValid) {
      dt = DateTime.fromRFC2822(dateObj);
    }
    if (!dt.isValid) {
      dt = DateTime.fromJSDate(new Date(dateObj));
    }
    return dt.isValid ? dt.toFormat(format) : "";
  });

  // Highlight keywords in HTML content (text nodes only, not attributes)
  eleventyConfig.addFilter("highlightKeywords", (html, keywords) => {
    if (!html || !keywords || keywords.length === 0) return html;

    const $ = cheerio.load(html, { decodeEntities: false });

    // Build regex for all keywords
    const pattern = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`(${pattern})`, 'gi');

    // Walk all text nodes and apply highlighting
    const highlightTextNodes = (node) => {
      if (node.type === 'text') {
        const text = node.data;
        if (regex.test(text)) {
          const highlighted = text.replace(regex, '<mark class="mention-keyword">$1</mark>');
          $(node).replaceWith(highlighted);
        }
      } else if (node.children) {
        node.children.forEach(child => highlightTextNodes(child));
      }
    };

    $('body').contents().each((i, node) => highlightTextNodes(node));

    return $('body').html();
  });

  // Sort posts by date (returns array of [url, post] pairs)
  eleventyConfig.addFilter("sortByDate", (obj, reverse = true) => {
    const entries = Object.entries(obj);
    entries.sort((a, b) => {
      const aDate = new Date(a[1].pubDate);
      const bDate = new Date(b[1].pubDate);
      return reverse ? bDate - aDate : aDate - bDate;
    });
    return entries;
  });

  return {
    dir: {
      input: "src",
      output: "_site",
      includes: "../_includes",
      data: "../_data"
    },
    templateFormats: ["njk", "html"],
    htmlTemplateEngine: "njk"
  };
};
