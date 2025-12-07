// Marham.pk doctors scraper - Sitemap + JSON-LD approach
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';

const headerGenerator = new HeaderGenerator();
const getStealthHeaders = (referer) => headerGenerator.getHeaders({}, referer ? { referer } : {});

const SITEMAP_URLS = [
    'https://www.marham.pk/sitemap_doctors.xml',
    'https://www.marham.pk/sitemap_doctors_1.xml',
];

const toAbs = (href, base = 'https://www.marham.pk') => {
    try { return new URL(href, base).href; } catch { return null; }
};

const normalizeSlug = (value = '') => {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[\s_]+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
};

/**
 * Parse sitemap XML and filter doctor URLs by specialty and city
 * URL format: /doctors/{city}/{specialty}/{doctor-slug}
 * or: /online-consultation/{specialty}/{city}/{doctor-slug}
 */
const parseSitemapAndFilter = (xml, { specialtySlug, citySlug, limit }) => {
    const urls = [];
    const regex = /<loc>([^<]+)<\/loc>/g;
    let match;

    while ((match = regex.exec(xml)) !== null && urls.length < limit) {
        const rawUrl = match[1]?.trim();
        if (!rawUrl) continue;

        let parsed;
        try {
            parsed = new URL(rawUrl);
        } catch {
            continue;
        }

        const segments = parsed.pathname.split('/').filter(Boolean);
        if (segments.length < 3) continue;

        // Match /doctors/{city}/{specialty}/{slug}
        if (segments[0] === 'doctors' && segments.length >= 4) {
            const urlCity = normalizeSlug(segments[1]);
            const urlSpecialty = normalizeSlug(segments[2]);

            const cityMatches = !citySlug || urlCity === citySlug;
            const specialtyMatches = !specialtySlug || urlSpecialty === specialtySlug;

            if (cityMatches && specialtyMatches) {
                urls.push(parsed.href);
            }
        }

        // Also match /online-consultation/{specialty}/{city}/{slug}
        if (segments[0] === 'online-consultation' && segments.length >= 4) {
            const urlSpecialty = normalizeSlug(segments[1]);
            const urlCity = normalizeSlug(segments[2]);

            const cityMatches = !citySlug || urlCity === citySlug;
            const specialtyMatches = !specialtySlug || urlSpecialty === specialtySlug;

            if (cityMatches && specialtyMatches) {
                urls.push(parsed.href);
            }
        }
    }

    return urls;
};

/**
 * Fetch and filter doctor URLs from sitemaps
 */
const fetchFilteredDoctorUrls = async ({ specialtySlug, citySlug, limit, proxyConf }) => {
    const urls = [];

    for (const sitemapUrl of SITEMAP_URLS) {
        if (urls.length >= limit) break;

        try {
            log.info(`Fetching sitemap: ${sitemapUrl}`);
            const response = await gotScraping({
                url: sitemapUrl,
                headers: getStealthHeaders(sitemapUrl),
                responseType: 'text',
                proxyUrl: proxyConf ? await proxyConf.newUrl() : undefined,
                timeout: { request: 60000 },
            });

            const remaining = limit - urls.length;
            const filtered = parseSitemapAndFilter(response.body, {
                specialtySlug,
                citySlug,
                limit: remaining,
            });

            urls.push(...filtered);
            log.info(`Found ${filtered.length} matching URLs from ${sitemapUrl} (total: ${urls.length})`);
        } catch (err) {
            log.warning(`Sitemap fetch failed for ${sitemapUrl}: ${err.message}`);
        }
    }

    return urls.slice(0, limit);
};

/**
 * Extract doctor data from JSON-LD Physician schema
 */
const extractFromJsonLd = ($, targetUrl = '') => {
    const scripts = $('script[type="application/ld+json"]');

    for (let i = 0; i < scripts.length; i++) {
        const payload = $(scripts[i]).html();
        if (!payload) continue;

        try {
            const parsed = JSON.parse(payload);
            const entries = Array.isArray(parsed) ? parsed : [parsed];

            for (const entry of entries) {
                if (!entry) continue;

                const type = entry['@type'] || entry.type;
                const types = Array.isArray(type) ? type : [type];

                if (types.some(t => t === 'Physician' || t === 'MedicalBusiness' || t === 'Person')) {
                    const hospitals = [];
                    if (Array.isArray(entry.hospitalAffiliation)) {
                        entry.hospitalAffiliation.forEach(h => {
                            if (h?.name) hospitals.push(h.name);
                        });
                    }

                    const services = [];
                    if (entry.AvailableService) {
                        const svcList = Array.isArray(entry.AvailableService)
                            ? entry.AvailableService
                            : [entry.AvailableService];
                        svcList.forEach(s => {
                            if (typeof s === 'string') services.push(s);
                            else if (s?.name) services.push(s.name);
                        });
                    }

                    return {
                        name: entry.name || null,
                        specialty: typeof entry.medicalSpecialty === 'string'
                            ? entry.medicalSpecialty
                            : entry.medicalSpecialty?.name || null,
                        description: entry.description || null,
                        hospitals: hospitals.length ? hospitals : null,
                        services: services.length ? services : null,
                        fee: entry.priceRange || null,
                        address: entry.address?.addressLocality || null,
                        url: entry.url || entry['@id'] || targetUrl,
                    };
                }
            }
        } catch {
            // Ignore malformed JSON
        }
    }

    return null;
};

/**
 * Extract doctor data from HTML as fallback
 */
const extractFromHtml = ($, url) => {
    // Extract name from h1 or meta
    const name = $('h1').first().text().trim() ||
        $('meta[property="og:title"]').attr('content')?.split('|')[0]?.trim() ||
        null;

    // Extract specialty
    const specialty = $('.specialty, [class*="specialty"], p.mt-10 strong.text-sm').first().text().trim() ||
        $('meta[name="keywords"]').attr('content')?.split(',')[0]?.trim() ||
        null;

    // Extract qualifications
    const qualifications = $('p.text-sm.mb-0').text().trim() || null;

    // Extract experience - look for "X Years" pattern
    const experienceText = $('[class*="experience"]').text() || $('body').text();
    const expMatch = experienceText.match(/(\d+)\s*(years?|yrs?)/i);
    const experience = expMatch ? `${expMatch[1]} years` : null;

    // Extract reviews count
    const reviewsText = $('[class*="review"]').text();
    const reviewMatch = reviewsText.match(/(\d+)/);
    let reviews = reviewMatch ? reviewMatch[1] : null;
    if (!reviews) {
        // Try to extract from script
        const scriptText = $('script').filter((_, el) => $(el).html().includes('numberOfReviews')).html();
        const scriptMatch = scriptText?.match(/numberOfReviews = "(\d+)"/);
        reviews = scriptMatch ? scriptMatch[1] : null;
    }

    // Extract satisfaction
    const satText = $('[class*="satisfaction"]').text();
    const satMatch = satText.match(/(\d+)/);
    const satisfaction = satMatch ? `${satMatch[1]}%` : null;

    // Extract fee
    const feeText = $('[class*="fee"], [class*="price"], [data-amount]').first();
    const fee = feeText.attr('data-amount')
        ? `Rs. ${feeText.attr('data-amount')}`
        : feeText.text().trim() || null;

    // Extract city from URL or page
    const urlCity = url.match(/\/doctors\/([^/]+)\//)?.[1] || null;
    const city = $('[class*="location"], [class*="city"]').first().text().trim() || urlCity;

    // Extract hospitals
    const hospitals = [];
    $('[class*="hospital"], [class*="clinic"], [data-hospitalname]').each((_, el) => {
        const name = $(el).attr('data-hospitalname') || $(el).text().trim();
        if (name && name.length > 3 && name.length < 200) {
            hospitals.push(name);
        }
    });

    // Extract services
    const services = [];
    $('.chips-highlight, [class*="service"]').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2 && text.length < 100) {
            services.push(text);
        }
    });

    // Check PMDC verification and video consultation
    const bodyText = $.text().toLowerCase();
    const pmdcVerified = bodyText.includes('pmdc verified');
    const videoConsultation = bodyText.includes('video consultation') || bodyText.includes('video call');

    // Extract about/description
    const about = $('[class*="about"], [class*="bio"], [class*="description"]').first().text().trim() || null;

    return {
        name,
        specialty,
        qualifications,
        experience,
        reviews_count: reviews,
        satisfaction,
        fee,
        city,
        hospitals: hospitals.length ? [...new Set(hospitals)] : null,
        services: services.length ? [...new Set(services)] : null,
        about,
        pmdc_verified: pmdcVerified,
        video_consultation: videoConsultation,
    };
};

/**
 * Merge JSON-LD and HTML data, preferring JSON-LD where available
 */
const mergeData = (jsonLd, html, url) => {
    return {
        name: jsonLd?.name || html?.name || null,
        specialty: jsonLd?.specialty || html?.specialty || null,
        qualifications: html?.qualifications || null,
        experience: html?.experience || null,
        reviews_count: html?.reviews_count || null,
        satisfaction: html?.satisfaction || null,
        fee: jsonLd?.fee || html?.fee || null,
        city: jsonLd?.address || html?.city || null,
        hospitals: jsonLd?.hospitals || html?.hospitals || null,
        available_days: null,
        services: jsonLd?.services || html?.services || null,
        about: jsonLd?.description || html?.about || null,
        url,
        pmdc_verified: html?.pmdc_verified || false,
        video_consultation: html?.video_consultation || false,
        _source: 'marham.pk',
    };
};

// Main execution
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            specialty = 'dermatologist',
            city = 'lahore',
            results_wanted: RESULTS_WANTED_RAW = 100,
            startUrl,
            startUrls,
            proxyConfiguration,
        } = input;

        const specialtySlug = normalizeSlug(specialty);
        const citySlug = normalizeSlug(city);
        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : 100;

        log.info(`Starting Marham.pk scraper: ${RESULTS_WANTED} ${specialty} doctors from ${city || 'all cities'}`);

        const proxyConf = await Actor.createProxyConfiguration(proxyConfiguration || {});
        let saved = 0;

        // Determine URLs to crawl
        let urlsToCrawl = [];

        // If custom URLs provided, use those
        if (Array.isArray(startUrls) && startUrls.length) {
            urlsToCrawl = startUrls.filter(Boolean);
            log.info(`Using ${urlsToCrawl.length} custom start URLs`);
        } else if (startUrl) {
            urlsToCrawl = [startUrl];
            log.info(`Using custom start URL: ${startUrl}`);
        } else {
            // Fetch filtered URLs from sitemap
            log.info(`Fetching doctor URLs from sitemap (specialty: ${specialtySlug}, city: ${citySlug})`);
            urlsToCrawl = await fetchFilteredDoctorUrls({
                specialtySlug,
                citySlug,
                limit: RESULTS_WANTED,
                proxyConf,
            });
            log.info(`Fetched ${urlsToCrawl.length} matching doctor profile URLs from sitemap`);
        }

        if (!urlsToCrawl.length) {
            log.warning('No URLs found to crawl. Check specialty and city inputs.');
            return;
        }

        log.info(`Prepare to crawl ${urlsToCrawl.length} URLs. First URL: ${urlsToCrawl[0]}`);

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5, // Reduced for stability during debug
            requestHandlerTimeoutSecs: 60,

            // Add explicit pre-navigation hook to verify request start
            preNavigationHooks: [
                async ({ request, log }) => {
                    log.info(`Preparing to navigate to ${request.url}`);
                    request.headers = {
                        ...request.headers,
                        ...getStealthHeaders(request.url),
                    };
                }
            ],

            async requestHandler({ request, $, log: crawlerLog }) {
                if (saved >= RESULTS_WANTED) return;

                crawlerLog.info(`Processing: ${request.url}`);

                try {
                    // Extract data from JSON-LD (primary source)
                    const jsonLdData = extractFromJsonLd($, request.url);

                    // Extract data from HTML (fallback/supplement)
                    const htmlData = extractFromHtml($, request.url);

                    // Merge data sources
                    const doctorData = mergeData(jsonLdData, htmlData, request.url);

                    // Validate we have at least a name
                    if (!doctorData.name) {
                        crawlerLog.warning(`No name found for ${request.url}, skipping`);
                        return;
                    }

                    await Dataset.pushData(doctorData);
                    saved++;
                    crawlerLog.info(`Saved doctor ${saved}/${RESULTS_WANTED}: ${doctorData.name}`);
                } catch (err) {
                    crawlerLog.error(`Failed to process ${request.url}: ${err.message}`);
                }
            },

            failedRequestHandler({ request, log: crawlerLog }) {
                crawlerLog.warning(`Request failed after retries: ${request.url}`);
            },
        });

        // Use uniqueKey to ensure requests are not skipped due to deduplication from previous runs
        const runId = Math.random().toString(36).substring(7);
        await crawler.run(urlsToCrawl.map(url => ({
            url,
            uniqueKey: `${url}#${runId}`
        })));

        log.info(`Finished. Saved ${saved} doctors.`);
    } catch (err) {
        log.error(`Critical error in main loop: ${err.message}`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
