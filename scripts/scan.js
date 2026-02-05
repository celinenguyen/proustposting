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

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .trim();
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
  return feed.items;
}

function findMentions(html, keywords) {
  const $ = cheerio.load(html);
  const mentions = [];

  // Get all text-containing elements
  const textElements = $('p, li, blockquote, h1, h2, h3, h4, h5, h6');

  textElements.each((i, el) => {
    const $el = $(el);
    const text = $el.text();

    for (const keyword of keywords) {
      const regex = new RegExp(keyword, 'gi');
      if (regex.test(text)) {
        // Find nearest preceding heading
        let nearestHeading = null;
        let headingSlug = null;

        const prevHeadings = $el.prevAll('h1, h2, h3, h4, h5, h6');
        if (prevHeadings.length > 0) {
          nearestHeading = prevHeadings.first().text().trim();
          headingSlug = slugify(nearestHeading);
        }

        // Get context: current element plus siblings
        let context = '';
        const prev = $el.prev('p, li, blockquote');
        const next = $el.next('p, li, blockquote');

        if (prev.length) {
          context += $.html(prev);
        }
        context += $.html($el);
        if (next.length) {
          context += $.html(next);
        }

        mentions.push({
          keyword,
          context,
          nearestHeading,
          headingSlug
        });

        // Only record one mention per keyword per element
        break;
      }
    }
  });

  return mentions;
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
    if (existingPost && existingPost.contentHash === contentHash) {
      // Content unchanged, keep existing data
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
