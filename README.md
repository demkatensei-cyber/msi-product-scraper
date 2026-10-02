# MSI Product Page Scraper

Playwright (JavaScript) scraper for one MSI US Store product page:
<https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI>

## Run

```bash
npm install
npx playwright install chromium
npm run scrape
```

The browser runs headless. The result is written to `output/product.json`.

The store is behind Akamai, which returns `403 Access Denied` to the default Playwright
headless shell and to `HeadlessChrome` user agents. The scraper therefore launches full Chromium
in new headless mode (`channel: 'chromium'`) with a regular Chrome user agent.

## How data is extracted

The store is OpenCart with no JSON-LD, so values are read from the DOM using ids and semantic markup:

- `item_id`: `input[name="product_id"]`
- `title`: `.product-detail h2.title`. `brand`: the word before the title in `<title>` ("MSI MAG Z890 ... - MSI-US Official Store")
- `category_tree`: `ol.breadcrumb` links without "Home". `product_category` is these names joined with ` > `
- `description`: summary paragraph under the title. The page's meta description describes a different product, so it is not used
- `price` / `sale_price`: `#prices-old` / `#prices-new`. Without a discount, `sale_price` is `null`
- `availability`: stock text in `#prices-wrapper`
- `image_url` / `additional_image_urls`: `#imagePopup` and the gallery `popup_img` attributes, deduplicated
- `specs`: spec table rows (`th[scope=row]` + `td`). Multi-line values are joined with `; `
- `star_rating` / `review_count`: `#average-rating-info` ("4.8 (12)"), loaded by AJAX. `null` when there are no reviews
- `mpn`: "Manufacturer Number" spec. `gtin`: GTIN/UPC/EAN spec if present, otherwise `null`
