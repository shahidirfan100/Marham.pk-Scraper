// Marham.pk doctors scraper - JSON API + HTML fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { load as cheerioLoad } from 'cheerio';
import { gotScraping } from 'got-scraping';

// Single-entrypoint main
await Actor.init();

async function main() {
    try {
        const input = (await Actor.getInput()) || {};
        const {
            specialty = 'dermatologist',
            city = '',
            results_wanted: RESULTS_WANTED_RAW = 100,
            max_pages: MAX_PAGES_RAW = 20,
            collectDetails = true,
            startUrl,
            startUrls,
            url,
            proxyConfiguration,
        } = input;

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 20;

        // Always try JSON API first for better performance, fallback to HTML parsing
        const useJsonApi = true;

        const toAbs = (href, base = 'https://www.marham.pk') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const cleanText = (html) => {
            if (!html) return '';
            const $ = cheerioLoad(html);
            $('script, style, noscript, iframe').remove();
            return $.root().text().replace(/\s+/g, ' ').trim();
        };

        const buildStartUrl = (spec, cty) => {
            const specialtySlug = String(spec || 'dermatologist').trim().toLowerCase().replace(/\s+/g, '-');
            if (cty) {
                const citySlug = String(cty).trim().toLowerCase().replace(/\s+/g, '-');
                return `https://www.marham.pk/doctors/${citySlug}/${specialtySlug}`;
            }
            return `https://www.marham.pk/doctors/${specialtySlug}`;
        };

        // Try JSON API first
        const fetchDoctorsFromAPI = async (spec, cty, page = 1) => {
            try {
                const apiUrl = 'https://www.marham.pk/api/doctors/search';
                const response = await gotScraping({
                    url: apiUrl,
                    method: 'POST',
                    json: {
                        specialty: spec,
                        city: cty || '',
                        page: page,
                        limit: 20
                    },
                    responseType: 'json',
                    timeout: { request: 30000 },
                });

                if (response.body && response.body.doctors) {
                    return {
                        doctors: response.body.doctors,
                        totalPages: response.body.totalPages || 1,
                        success: true
                    };
                }
                return { success: false };
            } catch (err) {
                log.warning(`JSON API failed: ${err.message}`);
                return { success: false };
            }
        };

        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls);
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(buildStartUrl(specialty, city));

        const proxyConf = proxyConfiguration ? await Actor.createProxyConfiguration({ ...proxyConfiguration }) : undefined;

        let saved = 0;

        // Try JSON API approach first for better performance, fallback to HTML parsing
        if (!initial.some(u => u !== buildStartUrl(specialty, city))) {
            log.info('Attempting JSON API approach...');
            let currentPage = 1;
            let hasMorePages = true;

            while (hasMorePages && saved < RESULTS_WANTED && currentPage <= MAX_PAGES) {
                const apiResult = await fetchDoctorsFromAPI(specialty, city, currentPage);
                
                if (apiResult.success && apiResult.doctors && apiResult.doctors.length > 0) {
                    const doctors = apiResult.doctors.slice(0, RESULTS_WANTED - saved);
                    
                    for (const doctor of doctors) {
                        if (saved >= RESULTS_WANTED) break;
                        
                        const item = {
                            name: doctor.name || null,
                            specialty: doctor.specialty || specialty || null,
                            qualifications: doctor.qualifications || null,
                            experience: doctor.experience || null,
                            satisfaction: doctor.satisfaction || null,
                            reviews_count: doctor.reviews || null,
                            fee: doctor.fee || null,
                            city: doctor.city || city || null,
                            hospital: doctor.hospital || null,
                            available_days: doctor.availableDays || null,
                            url: doctor.profileUrl ? toAbs(doctor.profileUrl) : null,
                            pmdc_verified: doctor.pmdcVerified || false,
                            video_consultation: doctor.videoConsultation || false,
                        };

                        await Dataset.pushData(item);
                        saved++;
                    }

                    log.info(`Page ${currentPage}: Saved ${doctors.length} doctors from JSON API`);
                    
                    if (currentPage >= apiResult.totalPages || doctors.length < 20) {
                        hasMorePages = false;
                    }
                    currentPage++;
                } else {
                    log.info('JSON API failed or returned no data, falling back to HTML parsing');
                    break;
                }
            }

            if (saved >= RESULTS_WANTED) {
                log.info(`Finished via JSON API. Saved ${saved} doctors`);
                return;
            }
        }

        function extractFromJsonLd($) {
            const scripts = $('script[type="application/ld+json"]');
            for (let i = 0; i < scripts.length; i++) {
                try {
                    const parsed = JSON.parse($(scripts[i]).html() || '');
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const e of arr) {
                        if (!e) continue;
                        const t = e['@type'] || e.type;
                        if (t === 'Physician' || t === 'MedicalBusiness' || (Array.isArray(t) && (t.includes('Physician') || t.includes('Person')))) {
                            return {
                                name: e.name || null,
                                specialty: e.medicalSpecialty || null,
                                description: e.description || null,
                                address: e.address || null,
                            };
                        }
                    }
                } catch (e) { /* ignore parsing errors */ }
            }
            return null;
        }

        function parseDoctorCard($, card) {
            const name = $(card).find('h3, h2, .doctor-name, [class*="name"]').first().text().trim() || null;
            const specialty = $(card).find('.specialty, [class*="specialty"]').first().text().trim() || null;
            const qualifications = $(card).find('.qualifications, [class*="qualification"]').first().text().trim() || null;
            const experience = $(card).find('[class*="experience"], .experience').first().text().trim() || null;
            const reviews = $(card).find('[class*="reviews"], .reviews').first().text().trim() || null;
            const satisfaction = $(card).find('[class*="satisfaction"], .satisfaction').first().text().trim() || null;
            const fee = $(card).find('[class*="fee"], .fee, [class*="price"]').first().text().trim() || null;
            const hospital = $(card).find('[class*="hospital"], .hospital, [class*="clinic"]').first().text().trim() || null;
            
            const profileLink = $(card).find('a[href*="/doctors/"]').first().attr('href');
            const profileUrl = profileLink ? toAbs(profileLink) : null;
            
            const pmdcVerified = $(card).text().includes('PMDC Verified') || $(card).find('[class*="verified"]').length > 0;
            const videoConsultation = $(card).text().includes('Video Consultation') || $(card).text().includes('Video Call');

            return {
                name,
                specialty,
                qualifications,
                experience,
                reviews_count: reviews,
                satisfaction,
                fee,
                hospital,
                url: profileUrl,
                pmdc_verified: pmdcVerified,
                video_consultation: videoConsultation,
            };
        }

        function findDoctorCards($) {
            const cards = [];
            // Multiple selector strategies for doctor cards
            const possibleSelectors = [
                'div[class*="doctor-card"]',
                'div[class*="DoctorCard"]',
                'article[class*="doctor"]',
                'div[class*="listing"]',
                'div.card',
                '[data-doctor-id]',
            ];

            for (const selector of possibleSelectors) {
                const elements = $(selector);
                if (elements.length > 0) {
                    elements.each((_, card) => {
                        const hasProfileLink = $(card).find('a[href*="/doctors/"]').length > 0;
                        if (hasProfileLink) cards.push(card);
                    });
                    if (cards.length > 0) break;
                }
            }

            return cards;
        }

        function findNextPage($, base) {
            // Look for pagination links
            const nextLink = $('a[rel="next"]').attr('href');
            if (nextLink) return toAbs(nextLink, base);
            
            const loadMore = $('a, button').filter((_, el) => {
                const text = $(el).text().toLowerCase();
                return text.includes('load more') || text.includes('next') || text.includes('›') || text.includes('»');
            }).first().attr('href');
            
            if (loadMore) return toAbs(loadMore, base);

            // Check for page number links
            const pageLinks = $('a[href*="page="], a[href*="/page/"]');
            if (pageLinks.length > 0) {
                const currentUrl = new URL(base);
                const currentPage = parseInt(currentUrl.searchParams.get('page') || '1');
                const nextPage = currentPage + 1;
                currentUrl.searchParams.set('page', nextPage.toString());
                return currentUrl.href;
            }

            return null;
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: 5,
            requestHandlerTimeoutSecs: 60,
            async requestHandler({ request, $, enqueueLinks, log: crawlerLog }) {
                const label = request.userData?.label || 'LIST';
                const pageNo = request.userData?.pageNo || 1;

                if (label === 'LIST') {
                    crawlerLog.info(`Processing LIST page ${pageNo}: ${request.url}`);
                    
                    const doctorCards = findDoctorCards($);
                    crawlerLog.info(`Found ${doctorCards.length} doctor cards on page ${pageNo}`);

                    if (doctorCards.length === 0) {
                        crawlerLog.warning(`No doctor cards found on ${request.url}`);
                        return;
                    }

                    const doctorLinks = [];
                    const quickData = [];

                    for (const card of doctorCards) {
                        if (saved >= RESULTS_WANTED) break;

                        const parsed = parseDoctorCard($, card);
                        
                        if (collectDetails && parsed.url) {
                            doctorLinks.push(parsed.url);
                        } else {
                            quickData.push({
                                ...parsed,
                                city: city || null,
                                _source: 'marham.pk',
                            });
                        }
                    }

                    if (collectDetails && doctorLinks.length > 0) {
                        const remaining = RESULTS_WANTED - saved;
                        const toEnqueue = doctorLinks.slice(0, Math.max(0, remaining));
                        if (toEnqueue.length) {
                            await enqueueLinks({ urls: toEnqueue, userData: { label: 'DETAIL' } });
                        }
                    } else if (quickData.length > 0) {
                        const remaining = RESULTS_WANTED - saved;
                        const toPush = quickData.slice(0, Math.max(0, remaining));
                        await Dataset.pushData(toPush);
                        saved += toPush.length;
                        crawlerLog.info(`Saved ${toPush.length} doctors without details (total: ${saved})`);
                    }

                    if (saved < RESULTS_WANTED && pageNo < MAX_PAGES) {
                        const next = findNextPage($, request.url);
                        if (next) {
                            crawlerLog.info(`Enqueueing next page: ${next}`);
                            await enqueueLinks({ urls: [next], userData: { label: 'LIST', pageNo: pageNo + 1 } });
                        } else {
                            crawlerLog.info('No next page found');
                        }
                    }
                    return;
                }

                if (label === 'DETAIL') {
                    if (saved >= RESULTS_WANTED) return;
                    
                    try {
                        crawlerLog.info(`Processing DETAIL page: ${request.url}`);
                        
                        const json = extractFromJsonLd($);
                        let data = json || {};

                        // Extract doctor information from detail page
                        if (!data.name) data.name = $('h1, [class*="doctor-name"]').first().text().trim() || null;
                        if (!data.specialty) data.specialty = $('[class*="specialty"], .specialty').first().text().trim() || specialty || null;
                        
                        const qualifications = $('[class*="qualification"], .qualifications, [class*="degree"]').first().text().trim() || null;
                        const experience = $('[class*="experience"], .experience').text().match(/\d+/)?.[0] || null;
                        const reviews = $('[class*="review"]').text().match(/\d+/)?.[0] || null;
                        const satisfaction = $('[class*="satisfaction"]').text().match(/\d+/)?.[0] || null;
                        const fee = $('[class*="fee"], [class*="price"]').text().trim() || null;
                        
                        // Extract hospital/clinic information
                        const hospitals = [];
                        $('[class*="hospital"], [class*="clinic"], [class*="location"]').each((_, el) => {
                            const text = $(el).text().trim();
                            if (text && text.length > 5) hospitals.push(text);
                        });

                        // Extract available days/times
                        const availability = $('[class*="available"], [class*="timing"], [class*="schedule"]').text().trim() || null;

                        // Extract services offered
                        const services = [];
                        $('[class*="service"], [class*="treatment"]').each((_, el) => {
                            const text = $(el).text().trim();
                            if (text && text.length > 2) services.push(text);
                        });

                        // Extract about/bio
                        const about = $('[class*="about"], [class*="bio"], [class*="description"]').first().text().trim() || null;

                        const pmdcVerified = $.text().includes('PMDC Verified') || $('[class*="verified"]').length > 0;
                        const videoConsultation = $.text().includes('Video Consultation') || $.text().includes('Video Call');

                        const item = {
                            name: data.name || null,
                            specialty: data.specialty || null,
                            qualifications: qualifications || null,
                            experience: experience ? `${experience} years` : null,
                            reviews_count: reviews || null,
                            satisfaction: satisfaction ? `${satisfaction}%` : null,
                            fee: fee || null,
                            city: city || null,
                            hospitals: hospitals.length > 0 ? hospitals : null,
                            available_days: availability || null,
                            services: services.length > 0 ? services : null,
                            about: about || null,
                            url: request.url,
                            pmdc_verified: pmdcVerified,
                            video_consultation: videoConsultation,
                            _source: 'marham.pk',
                        };

                        await Dataset.pushData(item);
                        saved++;
                        crawlerLog.info(`Saved doctor details (${saved}/${RESULTS_WANTED})`);
                    } catch (err) {
                        crawlerLog.error(`DETAIL ${request.url} failed: ${err.message}`);
                    }
                }
            }
        });

        await crawler.run(initial.map(u => ({ url: u, userData: { label: 'LIST', pageNo: 1 } })));
        log.info(`Finished. Saved ${saved} items`);
    } finally {
        await Actor.exit();
    }
}

main().catch(err => { console.error(err); process.exit(1); });
