const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');
const NodeCache = require('node-cache');

const app = express();
const port = 3000;

app.use(cors());
app.set('view engine', 'ejs');
app.set('views', './views');
app.use(express.static(path.join(__dirname, 'public')));

const cache = new NodeCache({ stdTTL: 3600 });

async function urlToBlob(url) {
    const fullUrl = url.startsWith('http') ? url : `https://komiku.id${url}`;
    try {
        const response = await axios.get(fullUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary').toString('base64');
        return `data:image/jpeg;base64,${buffer}`;
    } catch (error) {
        console.error('Error fetching image:', error);
        return url;
    }
}

async function scrapeData(page = 1, limit = 12) {
    const cacheKey = `mangaPage:${page}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
        return cachedData;
    }

    try {
        const { data } = await axios.get(`https://api.komiku.id/manga/page/${page}`);
        const $ = cheerio.load(data);
        const results = [];

        const mangaElements = $('.bge').toArray();
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        for (const element of mangaElements.slice(startIndex, endIndex)) {
            const title = $(element).find('h3').text().trim();
            const link = $(element).find('a').attr('href');
            const imageUrl = $(element).find('img').attr('src');
            const genre = $(element).find('.tpe1_inf b').text().trim();
            const readers = $(element).find('.judul2').text().trim();
            const summary = $(element).find('p').text().trim();
            const latestChapter = $(element).find('.new1:last-child span:last-child').text().trim();

            const image = await urlToBlob(imageUrl);

            results.push({
                title,
                link,
                image,
                genre,
                readers,
                summary,
                latestChapter,
            });
        }

        cache.set(cacheKey, results);
        return results;
    } catch (error) {
        console.error('Error fetching data:', error);
        return [];
    }
}

async function scrapeSearchData(query = '') {
    const cacheKey = `search:${query}`;
    const cachedData = cache.get(cacheKey);
    
    if (cachedData) {
        return cachedData;
    }

    try {
        const url = `https://api.komiku.id/?post_type=manga&s=${encodeURIComponent(query)}`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        const results = [];

        const mangaElements = $('.bge').toArray();
        for (const element of mangaElements) {
            const title = $(element).find('h3').text().trim();
            const link = $(element).find('a').attr('href');
            const imageUrl = $(element).find('img').attr('src');
            const genre = $(element).find('.tpe1_inf b').text().trim();
            const readers = $(element).find('.judul2').text().trim();
            const summary = $(element).find('p').text().trim();
            const latestChapter = $(element).find('.new1:last-child span:last-child').text().trim();

            const image = await urlToBlob(imageUrl);

            results.push({
                title,
                link: `https://komiku.id${link}`,
                image,
                genre,
                readers,
                summary,
                latestChapter,
            });
        }

        cache.set(cacheKey, results);
        return results;
    } catch (error) {
        console.error('Error fetching search data:', error);
        return [];
    }
}

app.get('/', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const data = await scrapeData(page, limit);

    if (req.xhr) {
        return res.json({ mangaList: data });
    }

    res.render('manga', { mangaList: data });
});

app.get('/search', async (req, res) => {
    const query = req.query.q || '';
    const results = await scrapeSearchData(query);

    res.render('searchResults', { query, results });
});

app.get('/manga/detail/:slug', async (req, res) => {
    const slug = req.params.slug;
    const mangaLink = `https://komiku.id/manga/${slug}/`;

    try {
        const { data } = await axios.get(mangaLink);
        const $ = cheerio.load(data);

        const chapters = [];
        $('#daftarChapter tr').each((index, element) => {
            const chapterTitle = $(element).find('.judulseries a span').text().trim();
            const chapterLink = $(element).find('.judulseries a').attr('href');
            const views = $(element).find('.pembaca i').text().trim();
            const date = $(element).find('.tanggalseries').text().trim();

            if (chapterTitle) {
                chapters.push({
                    title: chapterTitle,
                    link: chapterLink,
                    views,
                    date,
                });
            }
        });

        const imageUrl = $('img').attr('src');
        const mangaImage = await urlToBlob(imageUrl);

        const manga = {
            title: $('h1').text().trim(),
            imageUrl: mangaImage,
            indonesianTitle: $('td:contains("Judul Indonesia") + td').text().trim(),
            genre: $('ul.genre li span[itemprop="genre"]').map((i, el) => $(el).text().trim()).get(),
            author: $('td:contains("Pengarang") + td').text().trim(),
            status: $('td:contains("Status") + td').text().trim(),
            readerAge: $('td:contains("Umur Pembaca") + td').text().trim(),
            readingDirection: $('td:contains("Cara Baca") + td').text().trim(),
        };

        res.render('mangaDetail', {
            chapters,
            manga,
            firstChapter: chapters[0],
            lastChapter: chapters[chapters.length - 1],
        });
    } catch (error) {
        console.error('Error fetching manga details:', error);
        res.status(500).send('Error fetching manga details');
    }
});

app.get('/chapter/*', async (req, res) => {
    const chapterLink = req.params[0];
    try {
        const { data } = await axios.get(`https://komiku.id/${chapterLink}`);
        const $ = cheerio.load(data);
        const images = [];

        const imagePromises = $('#Baca_Komik img').map(async (index, element) => {
            const imgSrc = $(element).attr('src');
            const fallbackSrc = 'fallback-image-url.png';
            if (imgSrc) {
                const imageBlob = await urlToBlob(imgSrc);
                return { src: imageBlob, fallbackSrc };
            }
        }).get();

        const resolvedImages = await Promise.all(imagePromises);
        const chapterNumber = chapterLink.split('-').pop();

        const chapterData = {
            chapterNumber,
            images: resolvedImages.filter(image => image),
            chapterLink,
            totalImages: resolvedImages.length,
            viewLink: 'link-to-view-count',
        };

        res.render('chapter', chapterData);
    } catch (error) {
        console.error('Error fetching chapter data:', error);
        res.status(500).send('Error fetching chapter data');
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
