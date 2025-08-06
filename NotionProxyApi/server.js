const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const fs = require('fs');
const vm = require('vm'); // ✅ Add this

const NOTION_TOKEN = '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'; // 🔐 Replace with your Notion token
const NOTION_VERSION = '2022-06-28';
//ef10ac6f79524ea49e4bc0997e0ee704 == DB-TradingJournal
//5e00bcb25c3d4276b1de54de3576894a == DB-MonthlyLog

app.post('/api/createRelationId', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.notion.com/v1/pages',
      req.body,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.post('/api/getRelationName', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.notion.com/v1/databases/5e00bcb25c3d4276b1de54de3576894a/query',
      req.body,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.post('/api/getAllPagesFromDB', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.notion.com/v1/databases/ef10ac6f79524ea49e4bc0997e0ee704/query',
      req.body,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.patch('/api/patchRelationIdToTrade', async (req, res) => {
  try {
    // const url = "https://api.notion.com/v1/pages/" + req.url
    const pageId = req.body.url;
    const payload = req.body.payload;
    const response = await axios.patch(
      `https://api.notion.com/v1/pages/${pageId}`,
      req.body.payload,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.patch('/api/updatePropertiesToTrade', async (req, res) => {
  try {
    // const url = "https://api.notion.com/v1/pages/" + req.url
    const pageId = req.body.url;
    const payload = req.body.payload;
    const response = await axios.patch(
      `https://api.notion.com/v1/pages/${pageId}`,
      req.body.payload,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data.properties.PnL);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.post('/api/createNewEntry', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.notion.com/v1/pages',
      req.body,
      {
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          'Notion-Version': NOTION_VERSION,
          'Content-Type': 'application/json'
        }
      }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'Unknown error' });
  }
});

app.get('/api/news', async (req, res) => {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/115.0.0.0 Safari/537.36'
    );

    await page.goto('https://www.forexfactory.com/calendar', { waitUntil: 'domcontentloaded' });

    // Wait for dynamic JS to render content
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 3000)));

    const html = await page.content();
    fs.writeFileSync('calendar_loaded.html', html); // Optional: for debug

    // ✅ Extract JS object text using regex
    const scriptMatch = html.match(/window\.calendarComponentStates\[1\]\s*=\s*({[\s\S]*?});/);
    if (!scriptMatch) throw new Error('calendarComponentStates[1] not found');

    const codeToRun = `
      const result = {};
      window = { calendarComponentStates: {} };
      window.calendarComponentStates[1] = ${scriptMatch[1]};
      result.data = window.calendarComponentStates[1];
      result;
    `;

    // ✅ Run JavaScript safely using vm
    const sandbox = {};
    const script = new vm.Script(codeToRun);
    const context = vm.createContext(sandbox);
    const { data: calendarData } = script.runInContext(context);

    // ✅ Filter logic
    const allowedCurrencies = ['EUR', 'USD', 'GBP'];
    const allowedImpacts = ['high', 'non-economic'];
    const news = [];

    calendarData.days.forEach(day => {
      const dateText = day.date.replace(/<[^>]+>/g, '').trim();

      day.events.forEach(event => {
        const currency = event.currency;
        const impact = (event.impactName || '').toLowerCase();
        const eventName = event.name;
        const time = event.timeLabel;

        if (
          allowedCurrencies.includes(currency) &&
          allowedImpacts.includes(impact)
        ) {
          news.push({
            date: dateText,
            time,
            currency,
            event: eventName,
            impact
          });
        }
      });
    });

    res.json(news);

  } catch (err) {
    console.error('[ERROR]', err);
    res.status(500).json({
      error: 'Failed to fetch and parse news',
      details: err.message
    });
  } finally {
    if (browser) await browser.close();
  }
});







app.listen(3000, () => console.log('✅ Server running at http://localhost:3000'));
