# proustposting

A site that tracks every mention of Proust and *In Search of Lost Time* from the [Personal Canon](https://www.personalcanon.com) newsletter.

## Development

### Running the scan script

To fetch the latest mentions from the Personal Canon RSS feed and update the data:

```bash
npm run scan
```

This will:
- Fetch all posts from the Personal Canon RSS feed
- Search for mentions of "Proust" and "In Search of Lost Time"
- Extract context around each mention
- Update `_data/mentions.json` with the results

**Note:** The scan script uses `--disable-warning=DEP0040` to suppress the punycode deprecation warning. This warning comes from dependencies (cheerio/rss-parser), not our code. The warning is harmless and we're already using the latest versions of these packages.

### Building the site

```bash
npm run build        # Build for local preview
npm run build:ghpages # Build for GitHub Pages deployment
npm run dev          # Start development server with live reload
```

## Project Structure

- `_data/mentions.json` - Generated data file with all Proust mentions
- `scripts/scan.js` - Script to scan RSS feed and extract mentions
- `src/` - Eleventy source files
- `_includes/` - Nunjucks templates and CSS
