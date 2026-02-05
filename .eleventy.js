const { DateTime } = require("luxon");

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

  // Highlight keyword in HTML content
  eleventyConfig.addFilter("highlightKeyword", (html, keyword) => {
    if (!html || !keyword) return html;
    const regex = new RegExp(`(${keyword})`, 'gi');
    return html.replace(regex, '<mark class="mention-keyword">$1</mark>');
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
