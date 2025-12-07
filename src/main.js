// Marham.pk doctors scraper - JSON API + HTML fallback
import { Actor, log } from 'apify';
import { CheerioCrawler, Dataset } from 'crawlee';
import { gotScraping } from 'got-scraping';
import { HeaderGenerator } from 'header-generator';

const headerGenerator = new HeaderGenerator();

const getStealthHeaders = (referer) => headerGenerator.getHeaders({}, referer ? { referer } : {});

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
        const inputCity = typeof city === 'string' ? city.trim() : '';
        const cityForRun = inputCity || 'lahore';

        const RESULTS_WANTED = Number.isFinite(+RESULTS_WANTED_RAW) ? Math.max(1, +RESULTS_WANTED_RAW) : Number.MAX_SAFE_INTEGER;
        const MAX_PAGES = Number.isFinite(+MAX_PAGES_RAW) ? Math.max(1, +MAX_PAGES_RAW) : 20;
        const useJsonApi = true;
        const allowHtmlFallback = true;
        const JSON_API_LIMIT = 20;

        const toAbs = (href, base = 'https://www.marham.pk') => {
            try { return new URL(href, base).href; } catch { return null; }
        };

        const buildStartUrl = (spec, cty) => {
            const specialtySlug = String(spec || 'dermatologist').trim().toLowerCase().replace(/\s+/g, '-');
            if (cty) {
                const citySlug = String(cty).trim().toLowerCase().replace(/\s+/g, '-');
                return `https://www.marham.pk/doctors/${citySlug}/${specialtySlug}`;
            }
            return `https://www.marham.pk/doctors/${specialtySlug}`;
        };

        const parseAvailableServices = (service) => {
            if (!service) return [];
            const normalize = (value) => {
                if (Array.isArray(value)) {
                    return value.flatMap((node) => normalize(node));
                }
                if (typeof value === 'object' && value !== null) {
                    if (value.name) return normalize(value.name);
                    return [];
                }
                if (typeof value === 'string') {
                    let text = value.trim();
                    if (text.startsWith('[') && text.endsWith(']')) {
                        text = text.slice(1, -1);
                    }
                    return text
                        .split(',')
                        .map(part => part.trim())
                        .filter(Boolean);
                }
                return [];
            };
            return Array.from(new Set(normalize(service)));
        };

        const collectJsonLdEntries = ($) => {
            const entries = [];
            $('script[type="application/ld+json"]').each((_, script) => {
                const payload = $(script).html();
                if (!payload) return;
                try {
                    const parsed = JSON.parse(payload);
                    const arr = Array.isArray(parsed) ? parsed : [parsed];
                    for (const entry of arr) {
                        if (!entry) continue;
                        const type = entry['@type'] || entry.type;
                        const types = Array.isArray(type) ? type : [type];
                        if (types.some(t => t === 'Physician' || t === 'MedicalBusiness' || t === 'Person')) {
                            entries.push(entry);
                        }
                    }
                } catch (err) {
                    // ignore malformed scripts
                }
            });
            return entries;
        };

        const normalizeEntryUrl = (entry) => {
            if (!entry) return null;
            const href = entry.url || entry['@id'] || entry['@context'];
            if (!href) return null;
            return toAbs(href);
        };

        const createJsonLdMap = (entries) => {
            const map = new Map();
            for (const entry of entries) {
                const url = normalizeEntryUrl(entry);
                if (!url) continue;
                map.set(url, entry);
            }
            return map;
        };

        const extractFromJsonLd = ($, targetUrl = '') => {
            const entries = collectJsonLdEntries($);
            for (const entry of entries) {
                const entryUrl = normalizeEntryUrl(entry);
                if (targetUrl && entryUrl !== targetUrl) continue;
                return {
                    name: entry.name || null,
                    specialty: typeof entry.medicalSpecialty === 'string' ? entry.medicalSpecialty : entry.medicalSpecialty?.name || null,
                    description: entry.description || null,
                    hospitals: Array.isArray(entry.hospitalAffiliation)
                        ? entry.hospitalAffiliation.map(h => h.name).filter(Boolean)
                        : [],
                    services: parseAvailableServices(entry.AvailableService),
                    fee: entry.priceRange || null,
                    address: entry.address || null,
                    url: entryUrl,
                };
            }
            return null;
        };

        const parseDoctorCard = ($, card, jsonMap, specialtyFallback, cityFallback) => {
            const profileLink = $(card)
                .find('.dr_profile_open_frm_listing_btn_vprofile, .dr_profile_opened_from_listing')
                .filter((_, el) => {
                    const href = $(el).attr('href');
                    return href && href.includes('/doctors/');
                })
                .first();

            const profileUrl = profileLink.length ? toAbs(profileLink.attr('href')) : null;
            const jsonEntry = profileUrl ? jsonMap.get(profileUrl) : null;

            const name = $(card).find('h3').first().text().trim() || jsonEntry?.name || null;
            const specialtyText = $(card).find('p.mb-0.mt-10.text-sm').first().text().trim();
            const specialty = specialtyText || jsonEntry?.specialty || specialtyFallback || null;
            const qualificationEl = $(card).find('p.text-sm').filter((_, el) => !$(el).hasClass('mb-0')).first();
            const qualifications = qualificationEl.text().trim() || null;

            const stats = {};
            $(card).find('p.mb-0.text-sm').each((_, el) => {
                const key = $(el).text().trim().toLowerCase();
                const value = $(el).next('p').first().text().trim();
                if (key) stats[key] = value || stats[key];
            });

            const reviews = stats.reviews?.replace(/[^\d]/g, '') || null;
            const experience = stats.experience || null;
            const satisfaction = stats.satisfaction || null;

            const appointmentBlock = $(card).find('.product-card[data-amount]').first();
            const feeAmount = appointmentBlock.attr('data-amount');
            const feeText = feeAmount ? `Rs. ${feeAmount}` : $(card).find('p.price').first().text().trim() || jsonEntry?.fee || null;

            const hospitalSet = new Set();
            $(card).find('.product-card[data-hospitalname]').each((_, el) => {
                const hospital = $(el).attr('data-hospitalname');
                if (hospital) hospitalSet.add(hospital.trim());
            });
            if (Array.isArray(jsonEntry?.hospitals)) {
                jsonEntry.hospitals.forEach((hName) => { if (hName) hospitalSet.add(hName); });
            }

            const servicesSet = new Set();
            $(card).find('.chips-highlight').each((_, el) => {
                const text = $(el).text().trim();
                if (text) servicesSet.add(text);
            });
            if (Array.isArray(jsonEntry?.services)) {
                jsonEntry.services.forEach((record) => { if (record) servicesSet.add(record); });
            }

            const availableDays = appointmentBlock.attr('data-displaydayname') || null;
            const cityValue = cityFallback || appointmentBlock.attr('data-hospitalcity') || jsonEntry?.address?.addressLocality || null;
            const pmdcVerified = $(card).find('span.text-green').text().toLowerCase().includes('pmdc verified') ||
                $(card).text().toLowerCase().includes('pmdc verified');
            const videoConsultation = $(card).find('.dr_profile_opened_from_listing_btn_vcall').length > 0;

            return {
                name,
                specialty,
                qualifications,
                experience,
                reviews_count: reviews,
                satisfaction,
                fee: feeText,
                city: cityValue,
                hospitals: hospitalSet.size > 0 ? Array.from(hospitalSet) : null,
                available_days: availableDays,
                services: servicesSet.size > 0 ? Array.from(servicesSet) : null,
                about: jsonEntry?.description || null,
                url: profileUrl,
                pmdc_verified: pmdcVerified,
                video_consultation: videoConsultation,
                _source: 'marham.pk',
            };
        };

        const findDoctorCards = ($) => {
            const selectors = [
                '#doctor-listing1 .row.shadow-card',
                '.row.shadow-card',
                'div[class*="doctor-card"]',
                'article[class*="doctor"]',
                '[data-doctor-id]',
            ];
            const cards = [];
            for (const selector of selectors) {
                const elements = $(selector);
                if (elements.length === 0) continue;
                elements.each((_, card) => {
                    const hasLink = $(card).find('a[href*="/doctors/"]').length > 0;
                    if (hasLink) cards.push(card);
                });
                if (cards.length) break;
            }
            return cards;
        };

        const findNextPage = (request) => {
            const currentUrl = new URL(request.url);
            const currentPage = Number(currentUrl.searchParams.get('page') || '1');
            currentUrl.searchParams.set('page', (currentPage + 1).toString());
            return currentUrl.href;
        };

        const defaultStartUrl = buildStartUrl(specialty, cityForRun);
        const initial = [];
        if (Array.isArray(startUrls) && startUrls.length) initial.push(...startUrls.filter(Boolean));
        if (startUrl) initial.push(startUrl);
        if (url) initial.push(url);
        if (!initial.length) initial.push(defaultStartUrl);

        const proxyConf = await Actor.createProxyConfiguration(proxyConfiguration || {});
        let saved = 0;

        const fetchDoctorsFromAPI = async (spec, cty, page = 1) => {
            const apiUrl = 'https://www.marham.pk/api/doctors/search';
            const refererUrl = buildStartUrl(spec, cty);
            const headers = {
                ...getStealthHeaders(refererUrl),
                'x-requested-with': 'XMLHttpRequest',
                'content-type': 'application/json; charset=UTF-8',
            };
            try {
                const response = await gotScraping({
                    url: apiUrl,
                    method: 'POST',
                    json: {
                        specialty: spec,
                        speciality: spec,
                        city: cty || '',
                        page,
                        limit: JSON_API_LIMIT,
                    },
                    responseType: 'json',
                    headers,
                    timeout: { request: 30000 },
                    proxyUrl: proxyConf?.newUrl(),
                });

                const payload = response.body?.data ?? response.body ?? {};
                const doctors = payload?.doctors ?? payload?.results ?? payload?.items ?? [];
                const totalPages = Number.isFinite(+payload?.totalPages)
                    ? Number(payload.totalPages)
                    : Number.isFinite(+payload?.lastPage)
                        ? Number(payload.lastPage)
                        : Number.isFinite(+payload?.last_page)
                            ? Number(payload.last_page)
                            : 1;
                const success = Array.isArray(doctors) && doctors.length > 0;
                return {
                    success,
                    doctors,
                    totalPages: totalPages || 1,
                };
            } catch (err) {
                log.warning(`JSON API failed (page ${page}): ${err.message}`);
                return { success: false };
            }
        };

        const canUseJsonApi = useJsonApi && initial.length === 1 && initial[0] === defaultStartUrl;
        if (canUseJsonApi) {
            log.info('Attempting JSON API approach...');
            let currentPage = 1;
            let hasMorePages = true;

            while (hasMorePages && saved < RESULTS_WANTED && currentPage <= MAX_PAGES) {
            const apiResult = await fetchDoctorsFromAPI(specialty, cityForRun, currentPage);
                if (apiResult.success) {
                    const remaining = Math.max(0, RESULTS_WANTED - saved);
                    const doctors = apiResult.doctors.slice(0, remaining);

                    for (const doctor of doctors) {
                        if (saved >= RESULTS_WANTED) break;
                        const item = {
                            name: doctor.name || null,
                            specialty: doctor.speciality || doctor.specialty || specialty || null,
                            qualifications: doctor.qualifications || null,
                            experience: doctor.experience || null,
                            satisfaction: doctor.satisfaction || null,
                            reviews_count: doctor.reviews || null,
                            fee: doctor.fee || null,
                            city: doctor.city || cityForRun || null,
                            hospitals: doctor.hospitals ?? (doctor.hospital ? [doctor.hospital] : null),
                            available_days: doctor.availableDays || doctor.availability || null,
                            services: doctor.services ?? null,
                            about: doctor.description || null,
                            url: doctor.profileUrl ? toAbs(doctor.profileUrl) : null,
                            pmdc_verified: doctor.pmdcVerified || false,
                            video_consultation: doctor.videoConsultation || false,
                            _source: 'marham.pk',
                        };
                        await Dataset.pushData(item);
                        saved++;
                    }

                    log.info(`Page ${currentPage}: Saved ${doctors.length} doctors from JSON API`);
                    currentPage++;
                    hasMorePages = currentPage <= Math.max(1, apiResult.totalPages);
                } else {
                    log.warning('JSON API returned no data, falling back to HTML parsing');
                    hasMorePages = false;
                }
            }

            if (saved >= RESULTS_WANTED) {
                log.info(`Finished via JSON API. Saved ${saved} doctors`);
                return;
            }
            if (!allowHtmlFallback) {
                throw new Error('JSON API did not return enough results and HTML fallback is disabled.');
            }
        } else if (useJsonApi) {
            log.info('Skipping JSON API because a custom start URL was supplied');
        }

        const crawler = new CheerioCrawler({
            proxyConfiguration: proxyConf,
            maxRequestRetries: 3,
            useSessionPool: true,
            maxConcurrency: Math.min(10, Math.max(2, Math.ceil(RESULTS_WANTED / 25))),
            requestHandlerTimeoutSecs: 60,
            prepareRequestFunction({ request }) {
                const referer = request.userData?.referer || request.url;
                request.headers = {
                    ...request.headers,
                    ...getStealthHeaders(referer),
                };
                return request;
            },
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
                    const jsonLdMap = createJsonLdMap(collectJsonLdEntries($));

                    for (const card of doctorCards) {
                        if (saved >= RESULTS_WANTED) break;

                        const parsed = parseDoctorCard($, card, jsonLdMap, specialty, cityForRun);
                        
                        if (collectDetails && parsed.url) {
                            doctorLinks.push(parsed.url);
                        } else {
                            quickData.push(parsed);
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
                        const next = findNextPage(request);
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
                        
                        const json = extractFromJsonLd($, request.url);
                        const data = json || {};

                        // Extract doctor information from detail page
                        if (!data.name) data.name = $('h1, [class*="doctor-name"]').first().text().trim() || null;
                        if (!data.specialty) data.specialty = $('[class*="specialty"], .specialty').first().text().trim() || specialty || null;
                        
                        const qualifications = $('[class*="qualification"], .qualifications, [class*="degree"]').first().text().trim() || null;
                        const experience = $('[class*="experience"], .experience').text().match(/\d+/)?.[0] || null;
                        const reviews = $('[class*="review"]').text().match(/\d+/)?.[0] || null;
                        const satisfaction = $('[class*="satisfaction"]').text().match(/\d+/)?.[0] || null;
                        const fee = $('[class*="fee"], [class*="price"]').text().trim() || null;
                        
                        // Extract hospital/clinic information
                        const hospitals = new Set();
                        $('[class*="hospital"], [class*="clinic"], [class*="location"]').each((_, el) => {
                            const text = $(el).text().trim();
                            if (text && text.length > 5) hospitals.add(text);
                        });
                        if (Array.isArray(data.hospitals)) {
                            data.hospitals.forEach((hd) => { if (hd) hospitals.add(hd); });
                        }

                        // Extract available days/times
                        const availability = $('[class*="available"], [class*="timing"], [class*="schedule"]').text().trim() || null;

                        // Extract services offered
                        const services = new Set();
                        $('[class*="service"], [class*="treatment"]').each((_, el) => {
                            const text = $(el).text().trim();
                            if (text && text.length > 2) services.add(text);
                        });
                        if (Array.isArray(data.services)) {
                            data.services.forEach((svc) => { if (svc) services.add(svc); });
                        }

                        // Extract about/bio
                        const about = data.description || $('[class*="about"], [class*="bio"], [class*="description"]').first().text().trim() || null;

                        const pmdcVerified = $.text().includes('PMDC Verified') || $('[class*="verified"]').length > 0;
                        const videoConsultation = $.text().includes('Video Consultation') || $.text().includes('Video Call');

                        const cityValue = data.address?.addressLocality || cityForRun || null;
                        const item = {
                            name: data.name || null,
                            specialty: data.specialty || null,
                            qualifications: qualifications || null,
                            experience: experience ? `${experience} years` : null,
                            reviews_count: reviews || null,
                            satisfaction: satisfaction ? `${satisfaction}%` : null,
                            fee: fee || data.fee || null,
                            city: cityValue,
                            hospitals: hospitals.size > 0 ? Array.from(hospitals) : null,
                            available_days: availability || null,
                            services: services.size > 0 ? Array.from(services) : null,
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
