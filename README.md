# Marham.pk Doctors Scraper

Extract comprehensive doctor listings from Marham.pk, Pakistan's #1 healthcare platform. Get verified doctor profiles with qualifications, experience, reviews, fees, and availability information.

## What does Marham.pk Doctors Scraper do?

This powerful scraper extracts detailed information about doctors from Marham.pk. Whether you're building a healthcare directory, conducting market research, or analyzing medical services in Pakistan, this tool provides structured data efficiently.

### Key capabilities

- **Smart data extraction** - Automatically tries JSON API first for faster results, falls back to HTML parsing
- **Comprehensive information** - Name, specialty, qualifications, experience, fees, reviews, satisfaction ratings, and more
- **Flexible filtering** - Search by medical specialty and city
- **Detail mode** - Optional deep scraping to extract services, hospital affiliations, and complete profiles
- **Pagination support** - Automatically handles multiple pages of results
- **Verified data** - Includes PMDC verification status and video consultation availability

## Input configuration

Configure the scraper with these parameters:

### Required parameters

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| **specialty** | String | Medical specialty to search | `dermatologist`, `cardiologist`, `pediatrician` |

### Optional parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| **city** | String | - | Filter by city (e.g., `lahore`, `karachi`, `islamabad`) |
| **results_wanted** | Integer | 100 | Maximum number of doctors to extract |
| **max_pages** | Integer | 20 | Safety limit on pages to scrape |
| **collectDetails** | Boolean | true | Visit each doctor's profile for detailed information |
| **useJsonApi** | Boolean | true | Try JSON API first (faster, recommended) |
| **startUrl** | String | - | Custom Marham.pk URL to start from |
| **startUrls** | Array | - | Multiple URLs to scrape |
| **proxyConfiguration** | Object | Residential | Proxy settings (Apify Proxy recommended) |

### Input example

```json
{
  "specialty": "cardiologist",
  "city": "karachi",
  "results_wanted": 50,
  "max_pages": 5,
  "collectDetails": true,
  "useJsonApi": true,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Output format

Each doctor record contains:

```json
{
  "name": "Dr. Muhammad Ali",
  "specialty": "Cardiologist",
  "qualifications": "MBBS, FCPS (Cardiology)",
  "experience": "15 years",
  "reviews_count": "234",
  "satisfaction": "98%",
  "fee": "Rs. 2,000",
  "city": "Karachi",
  "hospitals": ["Aga Khan University Hospital", "South City Hospital"],
  "available_days": "Mon, Wed, Fri",
  "services": ["ECG", "Echocardiography", "Cardiac Consultation"],
  "about": "Experienced cardiologist specializing in interventional cardiology...",
  "url": "https://www.marham.pk/doctors/karachi/cardiologist/dr-muhammad-ali",
  "pmdc_verified": true,
  "video_consultation": true,
  "_source": "marham.pk"
}
```

### Output fields explained

- **name** - Doctor's full name
- **specialty** - Medical specialization
- **qualifications** - Academic degrees and certifications
- **experience** - Years of practice
- **reviews_count** - Number of patient reviews
- **satisfaction** - Patient satisfaction percentage
- **fee** - Consultation fee in PKR
- **city** - Practice location
- **hospitals** - Affiliated hospitals/clinics (array)
- **available_days** - Availability schedule
- **services** - Medical services offered (array)
- **about** - Professional biography
- **url** - Doctor's Marham.pk profile URL
- **pmdc_verified** - Pakistan Medical & Dental Council verification status
- **video_consultation** - Online consultation availability

## Use cases

### Healthcare platforms

Build comprehensive healthcare directories or doctor finder applications with verified, up-to-date information.

### Market research

Analyze healthcare service availability, pricing patterns, and specialty distribution across Pakistani cities.

### Appointment systems

Integrate doctor data into booking platforms or healthcare management systems.

### Medical analytics

Study doctor-to-patient ratios, specialty trends, and healthcare accessibility in different regions.

### Competitive analysis

Healthcare providers can benchmark services, fees, and patient satisfaction metrics.

## How it works

1. **Input processing** - Accepts specialty and city parameters
2. **Smart data fetching** - Tries JSON API first for optimal performance
3. **HTML fallback** - Automatically switches to HTML parsing if needed
4. **Pagination handling** - Navigates through multiple pages of results
5. **Detail extraction** - Optionally visits individual profiles for complete data
6. **Data structuring** - Outputs clean, consistent JSON records

## Performance and limits

- **Speed**: Processes 20-50 doctors per minute (varies with detail mode)
- **Pagination**: Supports up to 999 pages (configurable)
- **Rate limiting**: Uses proxies to avoid blocks
- **Reliability**: Dual extraction method (API + HTML) ensures high success rate

## Best practices

### For best results

✅ Use **JSON API mode** when possible (faster and more reliable)  
✅ Enable **residential proxies** for consistent access  
✅ Set reasonable **results_wanted** limits to optimize costs  
✅ Use **collectDetails: false** for faster, overview-only scraping  

### Common scenarios

**Quick overview** - Disable `collectDetails` to get basic information faster  
**Complete profiles** - Enable `collectDetails` for comprehensive data including services and hospitals  
**Specific specialty** - Use accurate specialty names like `dermatologist`, not `skin doctor`  
**City filtering** - Use lowercase city names: `lahore`, `karachi`, `islamabad`

## Integration example

```javascript
// Example: Using Apify SDK
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({
    token: 'YOUR_API_TOKEN',
});

const run = await client.actor('YOUR_USERNAME/marham-pk-doctors-scraper').call({
    specialty: 'neurologist',
    city: 'lahore',
    results_wanted: 30,
    collectDetails: true,
});

const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.log(items);
```

## Frequently asked questions

### What specialties can I search?

All medical specialties available on Marham.pk including: dermatologist, cardiologist, gynecologist, pediatrician, orthopedic surgeon, neurologist, psychiatrist, ENT specialist, urologist, gastroenterologist, and more.

### Which cities are supported?

All major Pakistani cities: Lahore, Karachi, Islamabad, Rawalpindi, Faisalabad, Multan, Peshawar, Quetta, Gujranwala, Sialkot, and others.

### How accurate is the data?

Data is extracted directly from Marham.pk and reflects current information. PMDC verification status ensures doctor authenticity.

### Can I scrape multiple specialties?

Yes, use the `startUrls` parameter to provide multiple specialty pages, or run the actor multiple times with different specialty values.

### What if the API fails?

The scraper automatically falls back to HTML parsing, ensuring you get results even if the JSON API is unavailable.

### How do I handle rate limits?

Use the provided proxy configuration with residential proxies. The scraper manages request timing automatically.

## Data compliance

This scraper extracts publicly available information from Marham.pk. Users are responsible for:

- Complying with Marham.pk's terms of service
- Respecting data privacy regulations
- Using extracted data ethically and legally
- Not overloading the target website

## Support and feedback

Need help or have suggestions? Contact the developer or open an issue in the actor's repository.

## Version history

**v1.0.0** - Initial release
- JSON API support
- HTML parsing fallback
- Specialty and city filtering
- Detail page scraping
- Comprehensive data extraction

---

**Keywords**: marham pakistan doctors scraper, healthcare data extraction, medical directory scraper, pakistan doctors database, marham.pk api, doctor listings scraper, medical specialty search, healthcare analytics pakistan
