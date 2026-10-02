const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const TARGET_URL = 'https://us-store.msi.com/Motherboards/Intel-Platform-Motherboard/INTEL-Z890/MAG-Z890-TOMAHAWK-WIFI';
const OUTPUT = path.join(__dirname, '..', 'output', 'product.json');

const clean = (s) => (s ? s.replace(/\s+/g, ' ').trim() : '') || null;
const toPrice = (s) => {
  const m = s && s.replace(/,/g, '').match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const toAvailability = (s) => {
  const t = (s || '').toLowerCase();
  if (/pre-?order/.test(t)) return 'pre_order';
  if (/out of stock|sold out/.test(t)) return 'out_of_stock';
  if (/in stock/.test(t)) return 'in_stock';
  return null;
};

// The store is OpenCart without JSON-LD, so raw values are read from the DOM by ids / semantic markup.
function readPage() {
  const text = (sel) => document.querySelector(sel)?.innerText ?? null;
  const attr = (sel, name) => document.querySelector(sel)?.getAttribute(name) ?? null;
  return {
    url: location.href,
    pageTitle: document.title,
    itemId: attr('input[name="product_id"]', 'value'),
    title: text('.product-detail h2.title'),
    description: text('.product-detail h2.title + div'),
    breadcrumbs: [...document.querySelectorAll('ol.breadcrumb li.breadcrumb-item:not(.active) a')].map((a) => ({
      name: a.innerText,
      url: a.href,
    })),
    oldPrice: text('#prices-old'),
    newPrice: text('#prices-new'),
    stock: text('#prices-wrapper'),
    image: document.querySelector('#imagePopup')?.src ?? null,
    gallery: [...document.querySelectorAll('#carouselImages img[popup_img]')].map((img) =>
      new URL(img.getAttribute('popup_img'), location.href).href
    ),
    specs: [...document.querySelectorAll('table tr:has(th[scope="row"])')].map((tr) => ({
      name: tr.querySelector('th').textContent,
      value: tr.querySelector('td')?.innerText.split('\n').map((l) => l.trim()).filter(Boolean).join('; '),
    })),
    rating: text('#average-rating-info'), // e.g. "4.8 (12)", loaded via AJAX
  };
}

function buildProduct(raw) {
  const title = clean(raw.title);
  const categoryTree = raw.breadcrumbs
    .map((b) => ({ name: clean(b.name), url: b.url || null }))
    .filter((b) => b.name && b.name.toLowerCase() !== 'home');
  const specs = raw.specs.map((s) => ({ name: clean(s.name), value: s.value && s.value !== '-' ? clean(s.value) : null }));
  const findSpec = (re) => specs.find((s) => re.test(s.name))?.value ?? null;

  const oldPrice = toPrice(raw.oldPrice);
  const newPrice = toPrice(raw.newPrice);
  const onSale = oldPrice !== null && newPrice !== null && newPrice < oldPrice;

  // <title> is "MSI MAG Z890 ... - MSI-US Official Store": the word before the product title is the brand.
  const titleIndex = title ? raw.pageTitle.toUpperCase().indexOf(title.toUpperCase()) : -1;
  const rating = (raw.rating || '').match(/([\d.]+)\s*\((\d+)\)/);

  return {
    url: raw.url,
    item_id: raw.itemId,
    title,
    brand: titleIndex > 0 ? clean(raw.pageTitle.slice(0, titleIndex)) : null,
    product_category: categoryTree.map((c) => c.name).join(' > ') || null,
    category_tree: categoryTree,
    description: clean(raw.description),
    price: onSale ? oldPrice : newPrice ?? oldPrice,
    sale_price: onSale ? newPrice : null,
    availability: toAvailability(raw.stock),
    image_url: raw.image,
    additional_image_urls: [...new Set(raw.gallery)].filter((u) => u !== raw.image),
    specs,
    star_rating: rating ? Number(rating[1]) : null,
    review_count: rating ? Number(rating[2]) : null,
    gtin: findSpec(/\b(gtin|upc|ean)\b/i),
    mpn: findSpec(/manufacturer (part )?number|\bmpn\b/i),
    scraped_at: new Date().toISOString(),
  };
}

async function main() {
  // Akamai returns 403 to the default headless shell and to "HeadlessChrome" user agents,
  // so use full Chromium in new headless mode with a regular Chrome user agent.
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`;
    const page = await browser.newPage({ userAgent });
    const response = await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status()} for ${TARGET_URL}`);

    await page.waitForSelector('.product-detail h2.title', { timeout: 30_000 });
    await page.waitForSelector('#average-rating-info', { timeout: 15_000 }).catch(() => {}); // no reviews is fine

    const product = buildProduct(await page.evaluate(readPage));
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(product, null, 2) + '\n');
    console.log(`Saved "${product.title}" with ${product.specs.length} specs to ${OUTPUT}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Scraping failed:', err.message);
  process.exitCode = 1;
});
