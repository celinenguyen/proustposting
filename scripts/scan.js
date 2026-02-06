const Parser = require('rss-parser');
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const RSS_URL = 'https://www.personalcanon.com/feed';
const SITEMAP_URL = 'https://www.personalcanon.com/sitemap.xml';
const MENTIONS_PATH = path.join(__dirname, '..', '_data', 'mentions.json');

const KEYWORDS = ['Proust', 'In Search of Lost Time'];

function transformImageUrl(url) {
  if (!url) return null;
  // Replace Substack's $s_!...! thumbnail parameter with explicit 300px dimensions
  if (url.includes('substackcdn.com/image/fetch/')) {
    return url.replace(/\$s_![^!]+!,/, 'w_300,h_300,c_fill,');
  }
  // Wrap direct S3 URLs in the Substack CDN with sizing
  if (url.includes('substack-post-media.s3.amazonaws.com')) {
    return `https://substackcdn.com/image/fetch/w_300,h_300,c_fill,f_auto,q_auto:good,fl_progressive:steep/${encodeURIComponent(url)}`;
  }
  return url;
}

function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex');
}

async function fetchSitemap() {
  console.log('Fetching sitemap...');
  const response = await fetch(SITEMAP_URL);
  const xml = await response.text();
  const $ = cheerio.load(xml, { xmlMode: true });

  const posts = {};
  $('url').each((i, el) => {
    const loc = $(el).find('loc').text();
    const lastmod = $(el).find('lastmod').text();
    // Only include actual posts (not the homepage or other pages)
    if (loc.includes('/p/')) {
      posts[loc] = { lastmod };
    }
  });

  console.log(`Found ${Object.keys(posts).length} posts in sitemap`);
  return posts;
}

async function fetchRSSFeed() {
  console.log('Fetching RSS feed...');
  const parser = new Parser({
    customFields: {
      item: [['content:encoded', 'contentEncoded']]
    }
  });

  const feed = await parser.parseURL(RSS_URL);
  console.log(`Found ${feed.items.length} items in RSS feed`);

  // Extract description and image URL from each item
  return feed.items.map(item => ({
    ...item,
    description: item.contentSnippet || item.content || '',
    imageUrl: item.enclosure?.url || null
  }));
}

function findMentions(html, keywords) {
  const $ = cheerio.load(html);

  // Fix Substack @mentions - extract display names and create links
  $('span.mention-wrap').each((i, el) => {
    const $span = $(el);
    const dataAttrs = $span.attr('data-attrs');

    if (dataAttrs) {
      try {
        const attrs = JSON.parse(dataAttrs);
        if (attrs.name) {
          // Determine the profile URL
          let profileUrl = attrs.url;
          if (!profileUrl) {
            // If no URL provided, construct Substack profile URL
            profileUrl = `https://substack.com/@${attrs.name}`;
          }

          // Replace span with a link
          const $link = $(`<a href="${profileUrl}" class="user-mention">@${attrs.name}</a>`);
          $span.replaceWith($link);
        }
      } catch (e) {
        // If JSON parsing fails, just leave the span as is
        console.warn('Failed to parse mention data-attrs:', e.message);
      }
    }
  });

  const mentionsByContext = new Map();

  // Text block elements we care about for context
  const TEXT_BLOCKS = 'p, li, blockquote, h1, h2, h3, h4, h5, h6';

  // Get all text-containing elements
  const textElements = $(TEXT_BLOCKS);

  // Track elements we've already processed to avoid duplicates from nesting
  const processedElements = new Set();

  textElements.each((i, el) => {
    const $el = $(el);

    // Skip if this element is nested inside another text block we've already processed
    // (e.g., a <p> inside a <blockquote> that was already handled)
    const isNestedInProcessed = $el.parents(TEXT_BLOCKS).toArray().some(parent =>
      processedElements.has(parent)
    );
    if (isNestedInProcessed) return;

    // Check if this element contains child text blocks with keywords
    // If so, skip this element - let the children handle it
    const childTextBlocks = $el.find(TEXT_BLOCKS);
    if (childTextBlocks.length > 0) {
      const childrenHaveKeyword = childTextBlocks.toArray().some(child => {
        const childText = $(child).text();
        return keywords.some(kw => new RegExp(kw, 'gi').test(childText));
      });
      if (childrenHaveKeyword) {
        // Don't process this container - its children will be processed
        return;
      }
    }

    const text = $el.text();

    // Collect all keywords found in this element
    const foundKeywords = [];
    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      if (regex.test(text)) {
        foundKeywords.push(keyword);
      }
    }

    if (foundKeywords.length === 0) return;

    // Mark this element as processed
    processedElements.add(el);

    // Find the context anchor - the element at the "top level" for sibling lookup
    // If we're inside a blockquote/li, use that for finding siblings
    let $contextAnchor = $el;
    const $parentBlock = $el.parent().closest(TEXT_BLOCKS);
    if ($parentBlock.length > 0) {
      $contextAnchor = $parentBlock;
    }

    // Find nearest preceding heading (look from context anchor level)
    let nearestHeading = null;

    const prevHeadings = $contextAnchor.prevAll('h1, h2, h3, h4, h5, h6');
    if (prevHeadings.length > 0) {
      nearestHeading = prevHeadings.first().text().trim();
    }

    // Get context: look for siblings of the context anchor
    const prev = $contextAnchor.prev(TEXT_BLOCKS);
    const next = $contextAnchor.next(TEXT_BLOCKS);

    const prevContext = prev.length ? $.html(prev) : null;
    const mentionContext = $.html($contextAnchor);
    const nextContext = next.length ? $.html(next) : null;

    // Create a deduplication key from all context parts
    const contextKey = (prevContext || '') + mentionContext + (nextContext || '');

    // Deduplicate by context - merge keywords if same context already exists
    if (mentionsByContext.has(contextKey)) {
      const existing = mentionsByContext.get(contextKey);
      for (const kw of foundKeywords) {
        if (!existing.keywords.includes(kw)) {
          existing.keywords.push(kw);
        }
      }
    } else {
      mentionsByContext.set(contextKey, {
        keywords: foundKeywords,
        prevContext,
        mentionContext,
        nextContext,
        nearestHeading
      });
    }
  });

  return Array.from(mentionsByContext.values());
}

async function loadExistingMentions() {
  try {
    const data = fs.readFileSync(MENTIONS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return {
      lastScanned: null,
      posts: {}
    };
  }
}

async function main() {
  console.log('Starting Proust mention scan...\n');

  // Load existing data
  const existingData = await loadExistingMentions();
  console.log(`Existing data has ${Object.keys(existingData.posts).length} posts\n`);

  // Fetch sitemap and RSS
  const sitemapPosts = await fetchSitemap();
  const rssItems = await fetchRSSFeed();

  // Create lookup map from RSS items
  const rssMap = {};
  for (const item of rssItems) {
    rssMap[item.link] = item;
  }

  // Process posts
  const newData = {
    lastScanned: new Date().toISOString(),
    posts: {}
  };

  let newPosts = 0;
  let updatedPosts = 0;
  let unchangedPosts = 0;
  let totalMentions = 0;

  for (const [url, sitemapInfo] of Object.entries(sitemapPosts)) {
    const rssItem = rssMap[url];

    if (!rssItem) {
      // Post not in RSS feed (might be too old), skip for now
      // Could fetch directly from URL if needed
      continue;
    }

    const content = rssItem.contentEncoded || rssItem.content || '';
    const contentHash = hashContent(content);

    // Check if we need to rescan
    const existingPost = existingData.posts[url];
    const hasMissingFields = existingPost && (!existingPost.description || !existingPost.imageUrl);
    if (existingPost && existingPost.contentHash === contentHash && !hasMissingFields) {
      // Content unchanged and has all fields, keep existing data
      newData.posts[url] = existingPost;
      unchangedPosts++;
      totalMentions += existingPost.mentions.length;
      continue;
    }

    // Scan for mentions
    const mentions = findMentions(content, KEYWORDS);

    if (mentions.length > 0) {
      newData.posts[url] = {
        title: rssItem.title,
        description: rssItem.description,
        imageUrl: rssItem.imageUrl,
        url: url,
        pubDate: rssItem.pubDate || rssItem.isoDate,
        lastmod: sitemapInfo.lastmod,
        contentHash: contentHash,
        mentions: mentions
      };

      totalMentions += mentions.length;

      if (existingPost) {
        updatedPosts++;
        console.log(`Updated: "${rssItem.title}" (${mentions.length} mentions)`);
      } else {
        newPosts++;
        console.log(`New: "${rssItem.title}" (${mentions.length} mentions)`);
      }
    }
  }

  // Transform image URLs to 300px versions
  for (const url of Object.keys(newData.posts)) {
    newData.posts[url].imageUrl = transformImageUrl(newData.posts[url].imageUrl);
  }

  // Write results
  fs.writeFileSync(MENTIONS_PATH, JSON.stringify(newData, null, 2));

  console.log('\n--- Summary ---');
  console.log(`New posts with mentions: ${newPosts}`);
  console.log(`Updated posts: ${updatedPosts}`);
  console.log(`Unchanged posts: ${unchangedPosts}`);
  console.log(`Total posts with mentions: ${Object.keys(newData.posts).length}`);
  console.log(`Total mentions found: ${totalMentions}`);
  console.log(`\nData saved to ${MENTIONS_PATH}`);
}

main().catch(console.error);
